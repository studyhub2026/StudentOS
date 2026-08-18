'use client';

import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { BookOpen, ChevronRight, MapPin, Plus, X, Loader2 } from 'lucide-react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/button';

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

export default function CoursesPage() {
  const router = useRouter();
  const { data: subjects, isLoading } = useSubjects();
  const [showAdd, setShowAdd] = useState(false);

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
            <motion.button
              key={s.id}
              variants={item}
              onClick={() => router.push(`/courses/${s.id}`)}
              className="text-left p-5 rounded-xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04] transition-colors group"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div
                    className="h-10 w-10 rounded-xl flex items-center justify-center text-lg shrink-0"
                    style={{ backgroundColor: s.color + '22', color: s.color }}
                  >
                    {s.icon ?? s.name.charAt(0)}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-[var(--text-primary)]">{s.name}</p>
                    {s.code && (
                      <p className="text-xs text-[var(--text-muted)]">{s.code}</p>
                    )}
                  </div>
                </div>
                <ChevronRight
                  size={16}
                  className="text-[var(--text-muted)] opacity-0 group-hover:opacity-100 transition-opacity mt-1"
                />
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
            </motion.button>
          ))}
        </motion.div>
      )}

      <AddCourseDialog open={showAdd} onClose={() => setShowAdd(false)} />
    </div>
  );
}
