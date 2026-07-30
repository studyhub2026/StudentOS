'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Copy,
  Hash,
  Loader2,
  Send,
  Trash2,
  Users,
  WifiOff,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useChatRealtime } from '@/hooks/use-chat-realtime';
import { useDeleteMessage, useGroup, useMessages } from '@/hooks/use-groups';
import { cn, initialsOf } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth-store';
import { toast } from 'sonner';

export default function GroupChatPage() {
  const params = useParams<{ groupId: string }>();
  const groupId = params.groupId;

  const currentUser = useAuthStore((state) => state.user);
  const { data: group, isLoading } = useGroup(groupId);

  const [channelId, setChannelId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Default to the first channel once the group loads.
  useEffect(() => {
    if (!channelId && group?.channels?.[0]) setChannelId(group.channels[0].id);
  }, [group, channelId]);

  const { data: page, isLoading: loadingMessages } = useMessages(groupId, channelId);
  const { connected, online, typingUsers, joinError, sendMessage, notifyTyping, stopTyping } =
    useChatRealtime(groupId, channelId);
  const deleteMessage = useDeleteMessage();

  // Keep the newest message in view as the conversation grows.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [page?.messages.length, typingUsers.length]);

  async function handleSend() {
    const content = draft.trim();
    if (!content || sending) return;

    setSending(true);
    // Clear optimistically; restore only if the send is rejected, so the
    // student never loses what they typed.
    setDraft('');
    stopTyping();

    const ok = await sendMessage(content);
    if (!ok) setDraft(content);

    setSending(false);
    inputRef.current?.focus();
  }

  const others = typingUsers.filter((user) => user.id !== currentUser?.id);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-5xl space-y-4">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-[32rem] w-full rounded-2xl" />
      </div>
    );
  }

  if (!group) {
    return (
      <Card className="mx-auto max-w-md text-center">
        <p className="font-medium">Group not found</p>
        <p className="mt-1 text-sm text-fg-muted">
          It may have been deleted, or you are no longer a member.
        </p>
        <Link href="/groups">
          <Button className="mt-4" variant="secondary">Back to groups</Button>
        </Link>
      </Card>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <Link href="/groups" className="inline-flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" aria-hidden />
        All groups
      </Link>

      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold tracking-tight">{group.name}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-fg-muted">
            <span>{group.members.length} members</span>
            <span
              className={cn(
                'flex items-center gap-1.5 text-xs',
                connected ? 'text-success' : 'text-warning',
              )}
            >
              <span
                className={cn(
                  'h-1.5 w-1.5 rounded-full',
                  connected ? 'bg-success' : 'bg-warning',
                )}
                aria-hidden
              />
              {connected ? `${online.length} online` : 'reconnecting…'}
            </span>
          </p>
        </div>

        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            void navigator.clipboard.writeText(group.inviteCode);
            toast.success('Invite code copied');
          }}
        >
          <Copy className="h-4 w-4" aria-hidden />
          {group.inviteCode}
        </Button>
      </header>

      {joinError ? (
        <Card className="border-danger/30 bg-danger/10">
          <p className="text-sm text-danger">{joinError}</p>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[12rem_minmax(0,1fr)_12rem]">
        {/* Channels */}
        <aside className="space-y-1">
          <p className="px-2 text-xs font-medium uppercase tracking-wide text-fg-subtle">
            Channels
          </p>
          {group.channels.map((channel) => (
            <button
              key={channel.id}
              type="button"
              aria-current={channelId === channel.id ? 'true' : undefined}
              onClick={() => setChannelId(channel.id)}
              className={cn(
                'flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm transition-colors',
                channelId === channel.id
                  ? 'bg-brand/12 font-medium text-brand-bright'
                  : 'text-fg-muted hover:bg-surface-raised hover:text-fg',
              )}
            >
              <Hash className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span className="truncate">{channel.name}</span>
            </button>
          ))}
        </aside>

        {/* Messages */}
        <Card className="flex h-[calc(100vh-18rem)] min-h-[24rem] flex-col p-0">
          <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
            {loadingMessages ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }, (_, index) => (
                  <Skeleton key={index} className="h-12 w-full" />
                ))}
              </div>
            ) : !page || page.messages.length === 0 ? (
              <div className="grid h-full place-items-center text-center">
                <div>
                  <Hash className="mx-auto h-8 w-8 text-fg-subtle" aria-hidden />
                  <p className="mt-2 text-sm text-fg-muted">No messages yet.</p>
                  <p className="text-xs text-fg-subtle">Say something to get started.</p>
                </div>
              </div>
            ) : (
              page.messages.map((message, index) => {
                const previous = page.messages[index - 1];
                // Collapse the avatar and name for consecutive messages from
                // the same author, as chat clients conventionally do.
                const grouped = previous?.author.id === message.author.id;
                const mine = message.author.id === currentUser?.id;

                return (
                  <div key={message.id} className={cn('group flex gap-3', grouped && '-mt-2')}>
                    {grouped ? (
                      <span className="w-8 shrink-0" />
                    ) : (
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand to-accent text-xs font-semibold text-white">
                        {initialsOf(message.author.name)}
                      </span>
                    )}

                    <div className="min-w-0 flex-1">
                      {grouped ? null : (
                        <p className="flex items-baseline gap-2">
                          <span className="text-sm font-medium">{message.author.name}</span>
                          <span className="text-xs text-fg-subtle">
                            {new Date(message.createdAt).toLocaleTimeString(undefined, {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        </p>
                      )}
                      <p className="break-words text-sm text-fg-muted">{message.content}</p>
                    </div>

                    {mine || group.ownerId === currentUser?.id ? (
                      <button
                        type="button"
                        aria-label="Delete message"
                        onClick={() => deleteMessage.mutate({ groupId, messageId: message.id })}
                        className="shrink-0 self-start rounded p-1 text-fg-subtle opacity-0 transition-opacity hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    ) : null}
                  </div>
                );
              })
            )}

            {others.length > 0 ? (
              <p className="flex items-center gap-2 text-xs italic text-fg-subtle">
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                {others.length === 1
                  ? `${others[0]?.name} is typing…`
                  : `${others.length} people are typing…`}
              </p>
            ) : null}
          </div>

          <div className="border-t border-border p-3">
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={draft}
                rows={1}
                onChange={(event) => {
                  setDraft(event.target.value);
                  notifyTyping();
                }}
                onBlur={stopTyping}
                onKeyDown={(event) => {
                  // Enter sends; Shift+Enter inserts a newline.
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    void handleSend();
                  }
                }}
                placeholder={connected ? 'Write a message…' : 'Reconnecting…'}
                disabled={!connected}
                aria-label="Message"
                className="max-h-32 min-h-[2.5rem] flex-1 resize-none rounded-xl border border-border bg-surface-raised px-3 py-2 text-sm placeholder:text-fg-subtle focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/40 disabled:opacity-50"
              />
              <Button
                size="icon"
                aria-label="Send message"
                disabled={!connected || !draft.trim()}
                loading={sending}
                onClick={() => void handleSend()}
              >
                {connected ? <Send className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </Card>

        {/* Members */}
        <aside className="space-y-1">
          <p className="flex items-center gap-1.5 px-2 text-xs font-medium uppercase tracking-wide text-fg-subtle">
            <Users className="h-3 w-3" aria-hidden />
            Members
          </p>
          {group.members.map((member) => {
            const isOnline = online.some((user) => user.id === member.user.id);
            return (
              <div key={member.id} className="flex items-center gap-2 rounded-xl px-2 py-1.5">
                <span className="relative shrink-0">
                  <span className="grid h-7 w-7 place-items-center rounded-full bg-gradient-to-br from-brand to-accent text-[10px] font-semibold text-white">
                    {initialsOf(member.user.name)}
                  </span>
                  <span
                    className={cn(
                      'absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-surface',
                      isOnline ? 'bg-success' : 'bg-fg-subtle',
                    )}
                    aria-label={isOnline ? 'online' : 'offline'}
                  />
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-fg-muted">
                  {member.user.name}
                </span>
              </div>
            );
          })}
        </aside>
      </div>
    </div>
  );
}
