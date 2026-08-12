'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  BarChart3,
  CheckSquare,
  Copy,
  ExternalLink,
  FileText,
  Hash,
  Link2,
  Loader2,
  MessageSquare,
  Plus,
  Send,
  Trash2,
  Users,
  WifiOff,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useChatRealtime } from '@/hooks/use-chat-realtime';
import { useDeleteMessage, useGroup, useMessages } from '@/hooks/use-groups';
import {
  useGroupResources,
  useAddResource,
  useDeleteResource,
  useGroupTasks,
  useAddTask,
  useToggleTask,
  useDeleteTask,
  useGroupPolls,
  useCreatePoll,
  useVotePoll,
  useClosePoll,
} from '@/hooks/use-group-extended';
import { cn, initialsOf } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth-store';
import { toast } from 'sonner';
import { apiErrorMessage } from '@/lib/api-client';

type GroupTab = 'chat' | 'resources' | 'tasks' | 'polls';

export default function GroupChatPage() {
  const params = useParams<{ groupId: string }>();
  const groupId = params.groupId;

  const currentUser = useAuthStore((state) => state.user);
  const { data: group, isLoading } = useGroup(groupId);

  const [activeTab, setActiveTab] = useState<GroupTab>('chat');
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

      <div className="flex gap-1 rounded-xl bg-surface-raised/60 p-1">
        {([
          { key: 'chat', label: 'Chat', icon: MessageSquare },
          { key: 'resources', label: 'Resources', icon: FileText },
          { key: 'tasks', label: 'Tasks', icon: CheckSquare },
          { key: 'polls', label: 'Polls', icon: BarChart3 },
        ] as const).map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setActiveTab(key)}
            className={cn(
              'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
              activeTab === key
                ? 'bg-brand/12 text-brand-bright'
                : 'text-fg-muted hover:text-fg',
            )}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden />
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'resources' && <GroupResourcesTab groupId={groupId} />}
      {activeTab === 'tasks' && <GroupTasksTab groupId={groupId} />}
      {activeTab === 'polls' && <GroupPollsTab groupId={groupId} currentUserId={currentUser?.id ?? ''} />}

      {activeTab === 'chat' && (
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
      )}
    </div>
  );
}

function GroupResourcesTab({ groupId }: { groupId: string }) {
  const { data: resources, isLoading } = useGroupResources(groupId);
  const addResource = useAddResource(groupId);
  const deleteResource = useDeleteResource(groupId);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [type, setType] = useState<'link' | 'note' | 'file'>('link');

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    try {
      await addResource.mutateAsync({ type, title: title.trim(), url: url.trim() || undefined });
      setTitle('');
      setUrl('');
      setShowForm(false);
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-widest text-fg-subtle">Shared Resources</p>
        <Button variant="outline" size="sm" onClick={() => setShowForm(!showForm)}>
          {showForm ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
          {showForm ? 'Cancel' : 'Add'}
        </Button>
      </div>

      {showForm && (
        <Card className="p-4">
          <form onSubmit={handleAdd} className="grid gap-3 sm:grid-cols-2">
            <select
              className="h-9 rounded-lg border border-border bg-surface-raised px-2 text-sm"
              value={type}
              onChange={(e) => setType(e.target.value as 'link' | 'note' | 'file')}
            >
              <option value="link">Link</option>
              <option value="note">Note</option>
              <option value="file">File</option>
            </select>
            <input
              className="h-9 rounded-lg border border-border bg-surface-raised px-2 text-sm"
              placeholder="Title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <input
              className="h-9 rounded-lg border border-border bg-surface-raised px-2 text-sm sm:col-span-2"
              placeholder="URL (optional)"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
            <Button type="submit" size="sm" disabled={addResource.isPending || !title.trim()}>
              Share
            </Button>
          </form>
        </Card>
      )}

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      ) : !resources || resources.length === 0 ? (
        <Card className="p-6 text-center text-sm text-fg-muted">
          No shared resources yet.
        </Card>
      ) : (
        <div className="space-y-2">
          {resources.map((r) => (
            <Card key={r.id} className="flex items-center gap-3 p-3">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand/12">
                {r.type === 'link' ? <Link2 className="h-4 w-4 text-brand-bright" /> : <FileText className="h-4 w-4 text-brand-bright" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {r.url ? (
                    <a href={r.url} target="_blank" rel="noopener noreferrer" className="hover:text-brand-bright">
                      {r.title} <ExternalLink className="ml-1 inline h-3 w-3" />
                    </a>
                  ) : r.title}
                </p>
                <p className="text-xs text-fg-subtle">
                  by {r.user.name} · {new Date(r.createdAt).toLocaleDateString()}
                </p>
              </div>
              <button
                type="button"
                className="shrink-0 rounded p-1 text-fg-subtle hover:text-danger transition-colors"
                onClick={() => void deleteResource.mutateAsync(r.id)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function GroupTasksTab({ groupId }: { groupId: string }) {
  const { data: tasks, isLoading } = useGroupTasks(groupId);
  const addTask = useAddTask(groupId);
  const toggleTask = useToggleTask(groupId);
  const deleteTask = useDeleteTask(groupId);
  const [newTitle, setNewTitle] = useState('');

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!newTitle.trim()) return;
    try {
      await addTask.mutateAsync({ title: newTitle.trim() });
      setNewTitle('');
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold uppercase tracking-widest text-fg-subtle">Group Tasks</p>

      <form onSubmit={handleAdd} className="flex gap-2">
        <input
          className="h-9 flex-1 rounded-lg border border-border bg-surface-raised px-3 text-sm"
          placeholder="Add a task..."
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
        />
        <Button type="submit" size="sm" disabled={addTask.isPending || !newTitle.trim()}>
          <Plus className="h-3.5 w-3.5" /> Add
        </Button>
      </form>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-10 w-full" />)}
        </div>
      ) : !tasks || tasks.length === 0 ? (
        <Card className="p-6 text-center text-sm text-fg-muted">
          No tasks yet. Add one above.
        </Card>
      ) : (
        <div className="space-y-1">
          {tasks.map((t) => (
            <div
              key={t.id}
              className="group flex items-center gap-3 rounded-lg border border-border p-2.5 text-sm"
            >
              <button
                type="button"
                onClick={() => void toggleTask.mutateAsync(t.id)}
                className={cn(
                  'flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors',
                  t.completed
                    ? 'border-success bg-success/20 text-success'
                    : 'border-border hover:border-brand',
                )}
              >
                {t.completed && <CheckSquare className="h-3 w-3" />}
              </button>
              <span className={cn('min-w-0 flex-1', t.completed && 'text-fg-subtle line-through')}>
                {t.title}
              </span>
              <span className="text-xs text-fg-subtle">{t.creator.name}</span>
              <button
                type="button"
                className="shrink-0 rounded p-1 text-fg-subtle opacity-0 hover:text-danger transition-opacity group-hover:opacity-100"
                onClick={() => void deleteTask.mutateAsync(t.id)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function GroupPollsTab({ groupId, currentUserId }: { groupId: string; currentUserId: string }) {
  const { data: polls, isLoading } = useGroupPolls(groupId);
  const createPoll = useCreatePoll(groupId);
  const votePoll = useVotePoll(groupId);
  const closePollMut = useClosePoll(groupId);
  const [showForm, setShowForm] = useState(false);
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const validOptions = options.filter((o) => o.trim());
    if (!question.trim() || validOptions.length < 2) return;
    try {
      await createPoll.mutateAsync({ question: question.trim(), options: validOptions });
      setQuestion('');
      setOptions(['', '']);
      setShowForm(false);
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-widest text-fg-subtle">Polls</p>
        <Button variant="outline" size="sm" onClick={() => setShowForm(!showForm)}>
          {showForm ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
          {showForm ? 'Cancel' : 'Create Poll'}
        </Button>
      </div>

      {showForm && (
        <Card className="p-4">
          <form onSubmit={handleCreate} className="space-y-3">
            <input
              className="h-9 w-full rounded-lg border border-border bg-surface-raised px-3 text-sm"
              placeholder="Poll question"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
            />
            {options.map((opt, i) => (
              <div key={i} className="flex gap-2">
                <input
                  className="h-9 flex-1 rounded-lg border border-border bg-surface-raised px-3 text-sm"
                  placeholder={`Option ${i + 1}`}
                  value={opt}
                  onChange={(e) => {
                    const next = [...options];
                    next[i] = e.target.value;
                    setOptions(next);
                  }}
                />
                {options.length > 2 && (
                  <button type="button" onClick={() => setOptions(options.filter((_, j) => j !== i))} className="text-fg-subtle hover:text-danger">
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
            {options.length < 6 && (
              <button type="button" onClick={() => setOptions([...options, ''])} className="text-xs text-brand-bright hover:underline">
                + Add option
              </button>
            )}
            <Button type="submit" size="sm" disabled={createPoll.isPending}>
              Create
            </Button>
          </form>
        </Card>
      )}

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 2 }, (_, i) => <Skeleton key={i} className="h-32 w-full" />)}
        </div>
      ) : !polls || polls.length === 0 ? (
        <Card className="p-6 text-center text-sm text-fg-muted">
          No polls yet.
        </Card>
      ) : (
        <div className="space-y-3">
          {polls.map((poll) => {
            const totalVotes = poll.options.reduce((sum, o) => sum + o.votes.length, 0);
            const isClosed = !!poll.closedAt;
            const myVote = poll.options.findIndex((o) => o.votes.includes(currentUserId));

            return (
              <Card key={poll.id} className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold">{poll.question}</p>
                    <p className="text-xs text-fg-subtle">
                      by {poll.user.name} · {totalVotes} vote{totalVotes !== 1 ? 's' : ''}
                      {isClosed && ' · Closed'}
                    </p>
                  </div>
                  {!isClosed && poll.user.id === currentUserId && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void closePollMut.mutateAsync(poll.id)}
                    >
                      Close
                    </Button>
                  )}
                </div>
                <div className="mt-3 space-y-2">
                  {poll.options.map((opt, i) => {
                    const pct = totalVotes > 0 ? Math.round((opt.votes.length / totalVotes) * 100) : 0;
                    const isMyVote = i === myVote;
                    return (
                      <button
                        key={i}
                        type="button"
                        disabled={isClosed}
                        onClick={() => void votePoll.mutateAsync({ pollId: poll.id, optionIndex: i })}
                        className={cn(
                          'relative flex w-full items-center justify-between rounded-lg border p-2.5 text-sm transition-colors',
                          isMyVote ? 'border-brand bg-brand/8' : 'border-border hover:border-brand/40',
                          isClosed && 'cursor-default',
                        )}
                      >
                        <span className={cn('relative z-10', isMyVote && 'font-medium')}>{opt.text}</span>
                        <span className="relative z-10 text-xs text-fg-subtle">{pct}%</span>
                        <span
                          className="absolute inset-y-0 left-0 rounded-lg bg-brand/10"
                          style={{ width: `${pct}%` }}
                        />
                      </button>
                    );
                  })}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
