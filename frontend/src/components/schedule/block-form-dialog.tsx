'use client';

import { useEffect, useState } from 'react';
import { CalendarDays, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useCreateBlock } from '@/hooks/use-schedule';
import { useSubjects } from '@/hooks/use-dashboard';
import { cn } from '@/lib/utils';
import type { CreateBlockBody, ScheduleBlockType } from '@/types/api';
import { useT } from '@/lib/i18n/provider';
import type { TranslationKey } from '@/lib/i18n/dictionaries';

const TYPES: { value: ScheduleBlockType; labelKey: TranslationKey }[] = [
  { value: 'STUDY', labelKey: 'blockForm.type.STUDY' },
  { value: 'CLASS', labelKey: 'blockForm.type.CLASS' },
  { value: 'FOCUS', labelKey: 'blockForm.type.FOCUS' },
  { value: 'EXAM', labelKey: 'blockForm.type.EXAM' },
  { value: 'BREAK', labelKey: 'blockForm.type.BREAK' },
  { value: 'PERSONAL', labelKey: 'blockForm.type.PERSONAL' },
];

interface BlockFormDialogProps {
  /** Prefills the start day when opened from a specific day column. */
  defaultDate?: Date;
  onClose: () => void;
}

/** A local `datetime-local` string for `date` at the given hour. */
function localAt(date: Date, hour: number): string {
  const d = new Date(date);
  d.setHours(hour, 0, 0, 0);
  const offset = d.getTimezoneOffset();
  return new Date(d.getTime() - offset * 60_000).toISOString().slice(0, 16);
}

export function BlockFormDialog({ defaultDate, onClose }: BlockFormDialogProps) {
  const base = defaultDate ?? new Date();
  const { data: subjects } = useSubjects();
  const create = useCreateBlock();
  const t = useT();

  const [title, setTitle] = useState('');
  const [type, setType] = useState<ScheduleBlockType>('STUDY');
  const [startAt, setStartAt] = useState(localAt(base, 9));
  const [endAt, setEndAt] = useState(localAt(base, 10));
  const [location, setLocation] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!title.trim()) {
      setError('Give the block a title.');
      return;
    }
    if (new Date(endAt) <= new Date(startAt)) {
      setError('The end time must be after the start time.');
      return;
    }

    const body: CreateBlockBody = {
      title: title.trim(),
      type,
      startAt: new Date(startAt).toISOString(),
      endAt: new Date(endAt).toISOString(),
      location: location.trim() || null,
      subjectId: subjectId || null,
    };

    create.mutate(body, {
      onSuccess: onClose,
      onError: (err) => setError(err instanceof Error ? err.message : 'Could not add the block.'),
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t('blockForm.newTitle')}
    >
      <button
        type="button"
        aria-label={t('common.close')}
        className="absolute inset-0 bg-black/65 backdrop-blur-sm"
        onClick={onClose}
      />

      <div className="glass relative flex max-h-[88vh] w-full max-w-lg flex-col overflow-y-auto rounded-2xl p-6">
        <header className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-semibold">
            <CalendarDays className="h-4 w-4 text-brand" aria-hidden />
            {t('blockForm.newTitle')}
          </h2>
          <button
            type="button"
            aria-label={t('common.close')}
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-lg text-fg-subtle transition-colors hover:bg-surface-raised hover:text-fg"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <Input
            label={t('blockForm.field.title')}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="e.g. Calculus revision"
            autoFocus
            maxLength={200}
          />

          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-subtle">{t('blockForm.field.type')}</p>
            <div className="flex flex-wrap gap-2">
              {TYPES.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={type === option.value}
                  onClick={() => setType(option.value)}
                  className={cn(
                    'rounded-full border px-3 py-1 text-xs transition-colors',
                    type === option.value
                      ? 'border-brand bg-brand/15 text-brand-bright'
                      : 'border-border text-fg-muted hover:border-border-strong',
                  )}
                >
                  {t(option.labelKey)}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-fg-muted" htmlFor="block-start">
                {t('blockForm.field.starts')}
              </label>
              <input
                id="block-start"
                type="datetime-local"
                value={startAt}
                onChange={(event) => setStartAt(event.target.value)}
                className="h-10 w-full rounded-xl border border-border bg-surface-raised px-3 text-sm focus:border-brand focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-fg-muted" htmlFor="block-end">
                {t('blockForm.field.ends')}
              </label>
              <input
                id="block-end"
                type="datetime-local"
                value={endAt}
                onChange={(event) => setEndAt(event.target.value)}
                className="h-10 w-full rounded-xl border border-border bg-surface-raised px-3 text-sm focus:border-brand focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-fg-muted" htmlFor="block-subject">
                {t('blockForm.field.subject')}
              </label>
              <select
                id="block-subject"
                value={subjectId}
                onChange={(event) => setSubjectId(event.target.value)}
                className="h-10 w-full rounded-xl border border-border bg-surface-raised px-3 text-sm focus:border-brand focus:outline-none"
              >
                <option value="">{t('assignmentForm.subject.none')}</option>
                {subjects?.map((subject) => (
                  <option key={subject.id} value={subject.id}>
                    {subject.name}
                  </option>
                ))}
              </select>
            </div>
            <Input
              label={t('blockForm.field.location')}
              value={location}
              onChange={(event) => setLocation(event.target.value)}
              placeholder="e.g. Library"
              maxLength={120}
            />
          </div>

          {error ? <p className="text-sm text-danger">{error}</p> : null}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={create.isPending}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {t('blockForm.submit')}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
