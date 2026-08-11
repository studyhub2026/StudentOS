'use client';

import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { BookOpen, ChevronRight, MapPin } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

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
      const { data } = await apiClient.get('/api/v1/subjects');
      return data.data;
    },
    staleTime: 60_000,
  });
}

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.04 } },
};

const item = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0 },
};

export default function CoursesPage() {
  const router = useRouter();
  const { data: subjects, isLoading } = useSubjects();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[var(--text-primary)]">Courses</h1>
        <p className="text-sm text-[var(--text-muted)] mt-1">
          Your subjects and course workspaces
        </p>
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
          <p className="text-sm text-[var(--text-muted)]">No courses yet. Add subjects to get started.</p>
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
                {s._count.assignments > 0 && <span>{s._count.assignments} assignments</span>}
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
    </div>
  );
}
