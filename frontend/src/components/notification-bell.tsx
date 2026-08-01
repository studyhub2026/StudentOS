'use client';

import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Bell, CheckCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useNotifications, useMarkRead, useMarkAllRead } from '@/hooks/use-notifications';
import { formatDistanceToNow } from 'date-fns';

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const { data: notifications } = useNotifications();
  const markRead = useMarkRead();
  const markAllRead = useMarkAllRead();

  const unreadCount = notifications?.filter((n) => !n.readAt).length ?? 0;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative grid h-9 w-9 place-items-center rounded-xl border border-border bg-surface-raised/60 text-fg-subtle transition-colors hover:text-fg"
        aria-label="Notifications"
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 ? (
          <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-danger px-0.5 text-[9px] font-bold text-white">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        ) : null}
      </button>

      <AnimatePresence>
        {open ? (
          <>
            <motion.div
              className="fixed inset-0 z-40"
              onClick={() => setOpen(false)}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            />
            <motion.div
              className="absolute right-0 top-12 z-50 w-80 overflow-hidden rounded-xl border border-border bg-surface shadow-xl"
              initial={{ opacity: 0, y: -8, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.95 }}
            >
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <h3 className="text-sm font-semibold">Notifications</h3>
                {unreadCount > 0 ? (
                  <button
                    type="button"
                    className="flex items-center gap-1 text-xs text-brand transition-colors hover:text-brand-bright"
                    onClick={() => markAllRead.mutate()}
                  >
                    <CheckCheck className="h-3 w-3" />
                    Mark all read
                  </button>
                ) : null}
              </div>

              <div className="max-h-80 overflow-y-auto">
                {!notifications?.length ? (
                  <div className="py-8 text-center text-sm text-fg-subtle">No notifications</div>
                ) : (
                  notifications.map((n) => (
                    <button
                      key={n.id}
                      type="button"
                      className={cn(
                        'flex w-full gap-3 border-b border-border/50 px-4 py-3 text-left transition-colors hover:bg-surface-raised',
                        !n.readAt && 'bg-brand/4',
                      )}
                      onClick={() => {
                        if (!n.readAt) markRead.mutate(n.id);
                        if (n.link) window.location.href = n.link;
                        setOpen(false);
                      }}
                    >
                      <div className="min-w-0 flex-1">
                        <p className={cn('text-sm', !n.readAt && 'font-medium')}>{n.title}</p>
                        {n.body ? <p className="mt-0.5 text-xs text-fg-subtle line-clamp-2">{n.body}</p> : null}
                        <p className="mt-1 text-[10px] text-fg-subtle">
                          {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
                        </p>
                      </div>
                      {!n.readAt ? (
                        <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-brand" />
                      ) : null}
                    </button>
                  ))
                )}
              </div>
            </motion.div>
          </>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
