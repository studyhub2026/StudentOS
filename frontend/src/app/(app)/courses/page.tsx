'use client';

import { useCallback, useRef, useState } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BookOpen, ChevronDown, ChevronRight, FileText, Image as ImageIcon,
  Loader2, MapPin, Paperclip, Plus, Trash2, Upload, X,
} from 'lucide-react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { apiClient, apiErrorMessage } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { useFileUpload, useDeleteFile, useDropzone } from '@/hooks/use-upload';
import type { Attachment } from '@/types/api';

interface SubjectSummary {
  id: string;
  name: string;
  code: string | null;
  color: string;
  icon: string | null;
  teacherName: string | null;
  room: string | null;
  credits: number | null;
  _count: { assignments: number };
  openCount?: number;
}

function useSubjects() {
  return useQuery<SubjectSummary[]>({
    queryKey: ['subjects-full'],
    queryFn: async () => {
      const { data } = await apiClient.get('/subjects');
      return data.data;
    },
    staleTime: 60_000,
  });
}

function useCourseFiles(subjectId: string | null) {
  return useQuery<Attachment[]>({
    queryKey: ['course-files', subjectId],
    queryFn: async () => {
      const { data } = await apiClient.get(`/uploads?subjectId=${subjectId}`);
      return data.data;
    },
    enabled: Boolean(subjectId),
    staleTime: 60_000,
  });
}

const PRESET_COLORS = [
  '#8b5cf6', '#6366f1', '#3b82f6', '#06b6d4',
  '#10b981', '#eab308', '#f97316', '#ef4444',
  '#ec4899', '#a855f7', '#14b8a6', '#64748b',
];

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.04 } },
};

const item = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0 },
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/* ── Delete Confirm Dialog ─────────────────────────────── */

function DeleteConfirmDialog({
  open,
  name,
  onConfirm,
  onCancel,
  isPending,
}: {
  open: boolean;
  name: string;
  onConfirm: () => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onCancel} />
      <div className="relative w-full max-w-sm rounded-2xl border border-white/[0.08] bg-[var(--bg-surface,#1a1a2e)] p-6 shadow-2xl">
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">Delete Course</h2>
            <p className="mt-2 text-sm text-[var(--text-muted)]">
              Are you sure you want to delete <strong className="text-[var(--text-primary)]">{name}</strong>?
              This will remove all associated assignments, notes, flashcards, and files.
            </p>
            <div className="flex justify-end gap-2 mt-5">
              <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={isPending}>
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={onConfirm}
                disabled={isPending}
                className="gap-1.5 bg-red-600 hover:bg-red-700 text-white"
              >
                {isPending && <Loader2 size={14} className="animate-spin" />}
                Delete
              </Button>
            </div>
          </div>
        </div>
  );
}

/* ── Course Files Panel ────────────────────────────────── */

function CourseFilesPanel({ subjectId }: { subjectId: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { data: files, isLoading } = useCourseFiles(subjectId);
  const upload = useFileUpload('courses', { subjectId });
  const remove = useDeleteFile();

  const { dragging, onDragOver, onDragLeave, onDrop } = useDropzone((file) =>
    upload.mutate(file),
  );

  return (
    <div className="mt-3 space-y-2" onClick={(e) => e.stopPropagation()}>
      {/* Drop zone */}
      <div
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={`rounded-lg border-2 border-dashed p-4 text-center transition-colors ${
          dragging ? 'border-[var(--brand)] bg-[var(--brand)]/10' : 'border-white/[0.08]'
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) upload.mutate(file);
            e.target.value = '';
          }}
        />

        {upload.progress ? (
          <div>
            <p className="text-xs text-[var(--text-muted)]">Uploading... {upload.progress.percent}%</p>
            <div className="mx-auto mt-1.5 h-1 w-full max-w-[200px] overflow-hidden rounded-full bg-white/[0.06]">
              <div
                className="h-full rounded-full bg-[var(--brand)] transition-all"
                style={{ width: `${upload.progress.percent}%` }}
              />
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="flex items-center gap-2 mx-auto text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
          >
            <Upload size={14} />
            Drop files here or click to upload
          </button>
        )}
      </div>

      {/* File list */}
      {isLoading ? (
        <div className="flex justify-center py-2">
          <Loader2 size={16} className="animate-spin text-[var(--text-muted)]" />
        </div>
      ) : files && files.length > 0 ? (
        <ul className="space-y-1">
          {files.map((file) => {
            const isImage = file.mimeType.startsWith('image/');
            return (
              <li
                key={file.id}
                className="group flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-white/[0.04] transition-colors"
              >
                {isImage ? (
                  <ImageIcon size={14} className="shrink-0 text-[var(--brand)]" />
                ) : (
                  <FileText size={14} className="shrink-0 text-[var(--text-muted)]" />
                )}
                <a
                  href={file.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-w-0 flex-1 truncate text-xs text-[var(--text-primary)] hover:underline"
                >
                  {file.filename}
                </a>
                <span className="shrink-0 text-[10px] text-[var(--text-muted)]">
                  {formatBytes(file.sizeBytes)}
                </span>
                <button
                  type="button"
                  onClick={() => remove.mutate(file.id)}
                  className="shrink-0 p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-red-500/20 text-[var(--text-muted)] hover:text-red-400 transition-all"
                  title="Remove file"
                >
                  <Trash2 size={12} />
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-center text-[10px] text-[var(--text-muted)] py-1">No files yet</p>
      )}
    </div>
  );
}

/* ── Add Course Dialog ─────────────────────────────────── */

function AddCourseDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [color, setColor] = useState(PRESET_COLORS[0]!);
  const [teacherName, setTeacherName] = useState('');
  const [room, setRoom] = useState('');
  const [credits, setCredits] = useState('');

  const reset = useCallback(() => {
    setName('');
    setCode('');
    setColor(PRESET_COLORS[0]!);
    setTeacherName('');
    setRoom('');
    setCredits('');
  }, []);

  const create = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = { name, color };
      if (code.trim()) body.code = code.trim();
      if (teacherName.trim()) body.teacherName = teacherName.trim();
      if (room.trim()) body.room = room.trim();
      if (credits.trim()) body.credits = Number(credits);
      const { data } = await apiClient.post('/subjects', body);
      return data.data as SubjectSummary;
    },
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ['subjects-full'] });
      qc.invalidateQueries({ queryKey: ['subjects'] });
      toast.success(`"${created.name}" created`);
      reset();
      onClose();
    },
    onError: () => {
      toast.error('Failed to create course');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    create.mutate();
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="absolute inset-0 bg-black/60" onClick={onClose} />
          <motion.div
            className="relative w-full max-w-md rounded-2xl border border-white/[0.08] bg-[var(--bg-surface,#1a1a2e)] p-6 shadow-2xl"
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            onAnimationComplete={() => nameRef.current?.focus()}
          >
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-semibold text-[var(--text-primary)]">Add Course</h2>
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg hover:bg-white/[0.06] transition-colors"
              >
                <X size={16} className="text-[var(--text-muted)]" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">
                  Course Name *
                </label>
                <input
                  ref={nameRef}
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Linear Algebra"
                  maxLength={80}
                  className="w-full rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]/50 focus:outline-none focus:ring-2 focus:ring-[var(--brand)]/50"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">
                    Course Code
                  </label>
                  <input
                    type="text"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="e.g. MATH201"
                    maxLength={20}
                    className="w-full rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]/50 focus:outline-none focus:ring-2 focus:ring-[var(--brand)]/50"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">
                    Credits
                  </label>
                  <input
                    type="number"
                    value={credits}
                    onChange={(e) => setCredits(e.target.value)}
                    placeholder="3"
                    min={0}
                    max={100}
                    className="w-full rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]/50 focus:outline-none focus:ring-2 focus:ring-[var(--brand)]/50"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">
                    Instructor
                  </label>
                  <input
                    type="text"
                    value={teacherName}
                    onChange={(e) => setTeacherName(e.target.value)}
                    placeholder="Dr. Smith"
                    maxLength={80}
                    className="w-full rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]/50 focus:outline-none focus:ring-2 focus:ring-[var(--brand)]/50"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">
                    Room
                  </label>
                  <input
                    type="text"
                    value={room}
                    onChange={(e) => setRoom(e.target.value)}
                    placeholder="Hall B-204"
                    maxLength={40}
                    className="w-full rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]/50 focus:outline-none focus:ring-2 focus:ring-[var(--brand)]/50"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--text-muted)] mb-2">
                  Color
                </label>
                <div className="flex flex-wrap gap-2">
                  {PRESET_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setColor(c)}
                      className="h-7 w-7 rounded-full transition-transform"
                      style={{
                        backgroundColor: c,
                        outline: color === c ? '2px solid white' : 'none',
                        outlineOffset: '2px',
                        transform: color === c ? 'scale(1.15)' : 'scale(1)',
                      }}
                    />
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={onClose}
                  disabled={create.isPending}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={!name.trim() || create.isPending}
                  className="gap-1.5"
                >
                  {create.isPending && <Loader2 size={14} className="animate-spin" />}
                  Create Course
                </Button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ── Course Card ───────────────────────────────────────── */

function CourseCard({
  s,
  onDelete,
}: {
  s: SubjectSummary;
  onDelete: (id: string, name: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <motion.div variants={item} className="rounded-xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04] transition-colors">
      <div className="p-5">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="h-10 w-10 rounded-xl flex items-center justify-center text-lg shrink-0"
              style={{ backgroundColor: s.color + '22', color: s.color }}
            >
              {s.icon ?? s.name.charAt(0)}
            </div>
            <div className="min-w-0">
              <Link href={`/courses/${s.id}`} className="block group/link">
                <p className="text-sm font-semibold text-[var(--text-primary)] truncate group-hover/link:text-[var(--brand)] transition-colors">{s.name}</p>
                {s.code && (
                  <p className="text-xs text-[var(--text-muted)]">{s.code}</p>
                )}
              </Link>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => setExpanded(!expanded)}
              className="p-1.5 rounded-lg hover:bg-white/[0.08] transition-colors"
              title="Files"
            >
              <Paperclip size={14} className="text-[var(--text-muted)]" />
            </button>
            <button
              onClick={() => onDelete(s.id, s.name)}
              className="p-1.5 rounded-lg hover:bg-red-500/20 transition-colors"
              title="Delete course"
            >
              <Trash2 size={14} className="text-[var(--text-muted)] hover:text-red-400" />
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-3 text-xs text-[var(--text-muted)]">
          {(s._count?.assignments ?? 0) > 0 && <span>{s._count.assignments} assignments</span>}
          {s.openCount != null && s.openCount > 0 && <span>{s.openCount} open</span>}
          {s.credits != null && <span>{s.credits} credits</span>}
        </div>

        {(s.teacherName || s.room) && (
          <div className="mt-3 flex items-center gap-3 text-xs text-[var(--text-muted)]">
            {s.teacherName && <span>{s.teacherName}</span>}
            {s.room && (
              <span className="flex items-center gap-1">
                <MapPin size={10} /> {s.room}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Expandable files panel */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-t border-white/[0.06]"
          >
            <div className="px-5 pb-4 pt-2">
              <div className="flex items-center gap-1.5 mb-1">
                <Paperclip size={12} className="text-[var(--text-muted)]" />
                <span className="text-xs font-medium text-[var(--text-muted)]">Course Files</span>
              </div>
              <CourseFilesPanel subjectId={s.id} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/* ── Main Page ─────────────────────────────────────────── */

export default function CoursesPage() {
  const qc = useQueryClient();
  const { data: subjects, isLoading } = useSubjects();
  const [showAdd, setShowAdd] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/subjects/${id}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['subjects-full'] });
      qc.invalidateQueries({ queryKey: ['subjects'] });
      toast.success(`"${deleteTarget?.name}" deleted`);
      setDeleteTarget(null);
    },
    onError: (error) => {
      toast.error(apiErrorMessage(error));
      setDeleteTarget(null);
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">Courses</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            Your subjects and course workspaces
          </p>
        </div>
        <Button onClick={() => setShowAdd(true)} size="sm" className="gap-1.5">
          <Plus size={16} />
          Add Course
        </Button>
      </div>

      {isLoading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-40 rounded-xl bg-white/[0.02] animate-pulse border border-white/[0.06]" />
          ))}
        </div>
      ) : !subjects || subjects.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <div className="h-16 w-16 rounded-2xl bg-white/[0.04] flex items-center justify-center">
            <BookOpen size={28} className="text-[var(--text-muted)]" />
          </div>
          <p className="text-sm text-[var(--text-muted)]">No courses yet.</p>
          <Button onClick={() => setShowAdd(true)} size="sm" variant="outline" className="gap-1.5">
            <Plus size={14} />
            Add your first course
          </Button>
        </div>
      ) : (
        <motion.div
          className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4"
          variants={container}
          initial="hidden"
          animate="show"
        >
          {subjects.map((s) => (
            <CourseCard
              key={s.id}
              s={s}
              onDelete={(id, name) => setDeleteTarget({ id, name })}
            />
          ))}
        </motion.div>
      )}

      <AddCourseDialog open={showAdd} onClose={() => setShowAdd(false)} />

      <DeleteConfirmDialog
        open={Boolean(deleteTarget)}
        name={deleteTarget?.name ?? ''}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        onCancel={() => setDeleteTarget(null)}
        isPending={deleteMutation.isPending}
      />
    </div>
  );
}
