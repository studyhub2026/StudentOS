'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { getSocket, type SocketUser } from '@/lib/socket';
import { groupKeys } from './use-groups';
import type { ChatMessage, MessagePage } from '@/types/api';

/**
 * Binds one group/channel to the shared socket.
 *
 * Incoming messages are written straight into the React Query cache rather
 * than triggering a refetch, so an active conversation never re-scrolls or
 * flickers. Listeners are scoped to this hook's lifetime and removed on
 * unmount, so switching channels cannot leave duplicate handlers attached.
 */
export function useChatSocket(groupId: string | null, channelId: string | null) {
  const queryClient = useQueryClient();

  const [connected, setConnected] = useState(false);
  const [online, setOnline] = useState<SocketUser[]>([]);
  const [typingUsers, setTypingUsers] = useState<SocketUser[]>([]);
  const [joinError, setJoinError] = useState<string | null>(null);

  // Avoids re-emitting typing:start on every keystroke.
  const typingSentAt = useRef(0);

  useEffect(() => {
    if (!groupId) return;

    const socket = getSocket();
    if (!socket) return;

    setConnected(socket.connected);

    const onConnect = () => {
      setConnected(true);
      socket.emit('group:join', groupId, (result) => {
        if (!result.ok) setJoinError(result.error ?? 'Could not join this group');
        else setJoinError(null);
      });
    };

    const onDisconnect = () => {
      setConnected(false);
      setOnline([]);
      setTypingUsers([]);
    };

    const onMessage = (message: ChatMessage & { channelId: string }) => {
      // Only append to the channel actually being viewed; other channels
      // refetch when opened.
      if (message.channelId !== channelId) return;

      queryClient.setQueryData<MessagePage>(
        groupKeys.messages(groupId, message.channelId),
        (current) => {
          if (!current) return current;
          // Guard against a duplicate if the sender also appended optimistically.
          if (current.messages.some((entry) => entry.id === message.id)) return current;
          return { ...current, messages: [...current.messages, message] };
        },
      );
    };

    const onDeleted = ({ messageId, channelId: deletedIn }: { messageId: string; channelId: string }) => {
      queryClient.setQueryData<MessagePage>(
        groupKeys.messages(groupId, deletedIn),
        (current) =>
          current
            ? { ...current, messages: current.messages.filter((m) => m.id !== messageId) }
            : current,
      );
    };

    const onTyping = ({ channelId: typingIn, users }: { channelId: string; users: SocketUser[] }) => {
      if (typingIn === channelId) setTypingUsers(users);
    };

    const onPresence = ({ groupId: inGroup, online: users }: { groupId: string; online: SocketUser[] }) => {
      if (inGroup === groupId) setOnline(users);
    };

    const onNotification = (payload: { title: string; body?: string }) => {
      toast(payload.title, payload.body ? { description: payload.body } : undefined);
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('message:new', onMessage);
    socket.on('message:deleted', onDeleted);
    socket.on('typing:update', onTyping);
    socket.on('presence:update', onPresence);
    socket.on('notification', onNotification);

    if (socket.connected) onConnect();

    return () => {
      socket.emit('group:leave', groupId);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('message:new', onMessage);
      socket.off('message:deleted', onDeleted);
      socket.off('typing:update', onTyping);
      socket.off('presence:update', onPresence);
      socket.off('notification', onNotification);
    };
  }, [groupId, channelId, queryClient]);

  const sendMessage = useCallback(
    (content: string, replyToId?: string): Promise<boolean> =>
      new Promise((resolve) => {
        const socket = getSocket();
        if (!socket || !groupId || !channelId) {
          resolve(false);
          return;
        }

        socket.emit(
          'message:send',
          { groupId, channelId, content, ...(replyToId ? { replyToId } : {}) },
          (result) => {
            if (!result.ok) toast.error(result.error ?? 'Message failed to send');
            resolve(result.ok);
          },
        );
      }),
    [groupId, channelId],
  );

  const notifyTyping = useCallback(() => {
    const socket = getSocket();
    if (!socket || !groupId || !channelId) return;

    // The server expires indicators after 5s, so re-emitting every 3s keeps
    // it alive while typing without flooding the connection.
    const now = Date.now();
    if (now - typingSentAt.current < 3000) return;

    typingSentAt.current = now;
    socket.emit('typing:start', { groupId, channelId });
  }, [groupId, channelId]);

  const stopTyping = useCallback(() => {
    const socket = getSocket();
    if (!socket || !groupId || !channelId) return;
    typingSentAt.current = 0;
    socket.emit('typing:stop', { groupId, channelId });
  }, [groupId, channelId]);

  return { connected, online, typingUsers, joinError, sendMessage, notifyTyping, stopTyping };
}
