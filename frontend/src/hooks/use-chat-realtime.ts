'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { apiClient, apiErrorMessage } from '@/lib/api-client';
import { getSupabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth-store';
import { groupKeys } from './use-groups';
import type { ChatMessage, MessagePage } from '@/types/api';

export interface PresenceUser {
  id: string;
  name: string;
  username: string;
  avatarUrl: string | null;
}

/** How long a typing indicator survives without a refresh. */
const TYPING_TTL_MS = 5000;
/** Re-emit interval while typing, comfortably under the TTL. */
const TYPING_THROTTLE_MS = 3000;

/**
 * Binds one group/channel to Supabase Realtime.
 *
 * - Messages: the REST API persists each write and broadcasts it on the group's
 *   topic, so incoming messages are written straight into the React Query cache
 *   rather than refetching — an active conversation never re-scrolls.
 * - Presence: Supabase tracks who is subscribed, giving the online list.
 * - Typing: a client-to-client broadcast that needs no server round-trip.
 *
 * Sending is a plain REST call; the server's broadcast echoes it back here (and
 * to everyone else), and the id guard keeps the sender from double-appending.
 */
export function useChatRealtime(groupId: string | null, channelId: string | null) {
  const queryClient = useQueryClient();
  const currentUser = useAuthStore((state) => state.user);

  const [connected, setConnected] = useState(false);
  const [online, setOnline] = useState<PresenceUser[]>([]);
  const [typingUsers, setTypingUsers] = useState<PresenceUser[]>([]);
  const [joinError, setJoinError] = useState<string | null>(null);

  const channelRef = useRef<RealtimeChannel | null>(null);
  const typingSentAt = useRef(0);
  const typingTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const me: PresenceUser | null = currentUser
    ? {
        id: currentUser.id,
        name: currentUser.name,
        username: currentUser.username,
        avatarUrl: currentUser.avatarUrl,
      }
    : null;
  const meKey = me ? JSON.stringify(me) : null;

  useEffect(() => {
    if (!groupId || !meKey) return;
    const self: PresenceUser = JSON.parse(meKey);

    const supabase = getSupabase();
    if (!supabase) {
      // Realtime is unconfigured — history still loads over REST, but there is
      // no live delivery. Leave the join error clear rather than alarming.
      setConnected(false);
      return;
    }

    const timers = typingTimers.current;
    const channel = supabase.channel(`group:${groupId}`, {
      config: { broadcast: { self: false }, presence: { key: self.id } },
    });
    channelRef.current = channel;

    channel.on('broadcast', { event: 'message:new' }, ({ payload }) => {
      const message = payload as ChatMessage & { channelId: string };
      // Only append to the channel actually being viewed; others refetch on open.
      if (message.channelId !== channelId) return;

      queryClient.setQueryData<MessagePage>(
        groupKeys.messages(groupId, message.channelId),
        (current) => {
          if (!current) return current;
          if (current.messages.some((entry) => entry.id === message.id)) return current;
          return { ...current, messages: [...current.messages, message] };
        },
      );
    });

    channel.on('broadcast', { event: 'message:deleted' }, ({ payload }) => {
      const { messageId, channelId: deletedIn } = payload as {
        messageId: string;
        channelId: string;
      };
      queryClient.setQueryData<MessagePage>(
        groupKeys.messages(groupId, deletedIn),
        (current) =>
          current
            ? { ...current, messages: current.messages.filter((m) => m.id !== messageId) }
            : current,
      );
    });

    channel.on('broadcast', { event: 'message:updated' }, ({ payload }) => {
      const message = payload as ChatMessage & { channelId: string | null };
      if (!channelId) return;
      queryClient.setQueryData<MessagePage>(groupKeys.messages(groupId, channelId), (current) =>
        current
          ? {
              ...current,
              messages: current.messages.map((m) =>
                m.id === message.id ? { ...m, ...message } : m,
              ),
            }
          : current,
      );
    });

    // Membership changes affect the roster and online list; refetch the detail.
    const onMembership = () => {
      void queryClient.invalidateQueries({ queryKey: groupKeys.detail(groupId) });
    };
    channel.on('broadcast', { event: 'member:joined' }, onMembership);
    channel.on('broadcast', { event: 'member:left' }, onMembership);

    channel.on('broadcast', { event: 'typing' }, ({ payload }) => {
      const { user, channelId: typingIn, typing } = payload as {
        user: PresenceUser;
        channelId: string;
        typing: boolean;
      };
      if (typingIn !== channelId || user.id === self.id) return;

      setTypingUsers((prev) => {
        const others = prev.filter((u) => u.id !== user.id);
        return typing ? [...others, user] : others;
      });

      const existing = timers.get(user.id);
      if (existing) clearTimeout(existing);
      if (typing) {
        timers.set(
          user.id,
          setTimeout(() => {
            setTypingUsers((prev) => prev.filter((u) => u.id !== user.id));
            timers.delete(user.id);
          }, TYPING_TTL_MS),
        );
      }
    });

    channel.on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState<PresenceUser>();
      const byId = new Map<string, PresenceUser>();
      for (const metas of Object.values(state)) {
        const meta = metas[0];
        if (meta) byId.set(meta.id, meta);
      }
      setOnline([...byId.values()]);
    });

    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        setConnected(true);
        setJoinError(null);
        void channel.track(self);
      } else {
        setConnected(false);
        if (status === 'CHANNEL_ERROR') setJoinError('Live connection failed — messages may be delayed.');
      }
    });

    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      void supabase.removeChannel(channel);
      channelRef.current = null;
      setConnected(false);
      setOnline([]);
      setTypingUsers([]);
    };
  }, [groupId, channelId, meKey, queryClient]);

  const sendMessage = useCallback(
    async (content: string, replyToId?: string): Promise<boolean> => {
      if (!groupId || !channelId) return false;
      try {
        await apiClient.post(`/groups/${groupId}/channels/${channelId}/messages`, {
          content,
          ...(replyToId ? { replyToId } : {}),
        });
        return true;
      } catch (error) {
        toast.error(apiErrorMessage(error));
        return false;
      }
    },
    [groupId, channelId],
  );

  const emitTyping = useCallback(
    (typing: boolean) => {
      const channel = channelRef.current;
      if (!channel || !channelId || !me) return;
      void channel.send({
        type: 'broadcast',
        event: 'typing',
        payload: { channelId, typing, user: me },
      });
    },
    [channelId, me],
  );

  const notifyTyping = useCallback(() => {
    const now = Date.now();
    if (now - typingSentAt.current < TYPING_THROTTLE_MS) return;
    typingSentAt.current = now;
    emitTyping(true);
  }, [emitTyping]);

  const stopTyping = useCallback(() => {
    typingSentAt.current = 0;
    emitTyping(false);
  }, [emitTyping]);

  return { connected, online, typingUsers, joinError, sendMessage, notifyTyping, stopTyping };
}
