'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import {
  ArrowLeft, BookOpen, Calendar, CheckSquare, FileText,
  GraduationCap, Layers, Star, Clock, MapPin, Bot, AlertTriangle,
} from 'lucide-react';
import { useCourseWorkspace } from '@/hooks/use-course-workspace';

const TABS = [
  { key: 'overview', label: 'Overview', icon: BookOpen },
  { key: 'assignments', label: 'Assignments', icon: CheckSquare },
  { key: 'notes', label: 'Notes', icon: FileText },
  { key: 'flashcards', label: 'Flashcards', icon: Layers },
  { key: 'schedule', label: 'Schedule', icon: Calendar },
  { key: 'grades', label: 'Grades', icon: GraduationCap },
] as const;

type Tab = (typeof TABS)[number]['key'];

function StatCard({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
      <p className="text-xs text-[var(--text-muted)] mb-1">{label}</p>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
    </div>
  );
}

export default function CourseWorkspacePage() {
  const params = useParams();
  const router = useRouter();
  const courseId = params.courseId as string;
  const [tab, setTab] = useState<Tab>('overview');

  const { data, isLoading, error } = useCourseWorkspace(courseId);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--brand)] border-t-transparent" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <p className="text-[var(--text-muted)]">Course not found</p>
        <button
          onClick={() => router.push('/dashboard')}
          className="text-sm text-[var(--brand)] hover:underline"
        >
          Back to Dashboard
        </button>
      </div>
    );
  }

  const { subject, stats, assignments, notes, decks, schedule, grades, tutor, lmsCourse } = data;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <button
          onClick={() => router.back()}
          className="mt-1 p-2 rounded-lg hover:bg-white/[0.06] transition-colors"
        >
          <ArrowLeft size={18} className="text-[var(--text-muted)]" />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <div
              className="h-10 w-10 rounded-xl flex items-center justify-center text-lg"
              style={{ backgroundColor: subject.color + '22', color: subject.color }}
            >
              {subject.icon ?? subject.name.charAt(0)}
            </div>
            <div>
              <h1 className="text-2xl font-bold text-[var(--text-primary)]">
                {subject.name}
              </h1>
              <div className="flex items-center gap-3 text-sm text-[var(--text-muted)]">
                {subject.code && <span>{subject.code}</span>}
                {subject.teacherName && <span>• {subject.teacherName}</span>}
                {subject.room && (
                  <span className="flex items-center gap-1">
                    <MapPin size={12} /> {subject.room}
                  </span>
                )}
                {lmsCourse && <span className="text-[var(--brand)]">• LMS synced</span>}
              </div>
            </div>
          </div>
        </div>
        {tutor && (
          <button
            onClick={() => router.push(`/tutors/${tutor.id}`)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--brand)]/10 text-[var(--brand)] hover:bg-[var(--brand)]/20 transition-colors text-sm font-medium"
          >
            <Bot size={16} />
            AI Tutor
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto border-b border-white/[0.06] pb-px">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`relative flex items-center gap-2 px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors ${
              tab === key
                ? 'text-[var(--brand)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
            }`}
          >
            <Icon size={16} />
            {label}
            {tab === key && (
              <motion.div
                layoutId="course-tab"
                className="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--brand)]"
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              />
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <motion.div
        key={tab}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
      >
        {tab === 'overview' && (
          <OverviewTab
            stats={stats}
            assignments={assignments}
            schedule={schedule}
            subject={subject}
          />
        )}
        {tab === 'assignments' && <AssignmentsTab assignments={assignments} />}
        {tab === 'notes' && <NotesTab notes={notes} />}
        {tab === 'flashcards' && <FlashcardsTab decks={decks} />}
        {tab === 'schedule' && <ScheduleTab schedule={schedule} />}
        {tab === 'grades' && <GradesTab grades={grades} averageGrade={stats.averageGrade} />}
      </motion.div>
    </div>
  );
}

function OverviewTab({
  stats,
  assignments,
  schedule,
  subject,
}: {
  stats: NonNullable<ReturnType<typeof useCourseWorkspace>['data']>['stats'];
  assignments: NonNullable<ReturnType<typeof useCourseWorkspace>['data']>['assignments'];
  schedule: NonNullable<ReturnType<typeof useCourseWorkspace>['data']>['schedule'];
  subject: NonNullable<ReturnType<typeof useCourseWorkspace>['data']>['subject'];
}) {
  const completionRate = stats.totalAssignments > 0
    ? Math.round((stats.completedAssignments / stats.totalAssignments) * 100)
    : 0;

  return (
    <div className="space-y-6">
      {/* Stats grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Assignments" value={stats.totalAssignments} color="text-[var(--text-primary)]" />
        <StatCard label="Completion Rate" value={`${completionRate}%`} color="text-[var(--brand)]" />
        <StatCard label="Average Grade" value={stats.averageGrade != null ? `${stats.averageGrade}%` : '—'} color="text-teal-400" />
        <StatCard label="Upcoming Exams" value={stats.upcomingExams} color={stats.upcomingExams > 0 ? 'text-amber-400' : 'text-[var(--text-muted)]'} />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Upcoming deadlines */}
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Upcoming Deadlines</h3>
          {assignments.filter((a) => a.dueAt && a.status !== 'COMPLETED' && a.status !== 'ARCHIVED').length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No upcoming deadlines</p>
          ) : (
            <div className="space-y-2">
              {assignments
                .filter((a) => a.dueAt && a.status !== 'COMPLETED' && a.status !== 'ARCHIVED')
                .slice(0, 5)
                .map((a) => {
                  const isOverdue = a.dueAt && new Date(a.dueAt) < new Date();
                  return (
                    <div key={a.id} className="flex items-center justify-between py-2 border-b border-white/[0.04] last:border-0">
                      <div className="flex items-center gap-2">
                        {isOverdue && <AlertTriangle size={14} className="text-red-400" />}
                        <span className="text-sm text-[var(--text-primary)]">{a.title}</span>
                      </div>
                      <span className={`text-xs ${isOverdue ? 'text-red-400' : 'text-[var(--text-muted)]'}`}>
                        {a.dueAt ? new Date(a.dueAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}
                      </span>
                    </div>
                  );
                })}
            </div>
          )}
        </div>

        {/* Upcoming schedule */}
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Upcoming Schedule</h3>
          {schedule.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No upcoming events</p>
          ) : (
            <div className="space-y-2">
              {schedule.slice(0, 5).map((b) => (
                <div key={b.id} className="flex items-center justify-between py-2 border-b border-white/[0.04] last:border-0">
                  <div>
                    <p className="text-sm text-[var(--text-primary)]">{b.title}</p>
                    <p className="text-xs text-[var(--text-muted)]">
                      {new Date(b.startAt).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                      {' '}
                      {new Date(b.startAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })}
                    </p>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    b.type === 'EXAM'
                      ? 'bg-red-500/10 text-red-400'
                      : b.type === 'CLASS'
                      ? 'bg-[var(--brand)]/10 text-[var(--brand)]'
                      : 'bg-white/[0.06] text-[var(--text-muted)]'
                  }`}>
                    {b.type}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Subject details */}
      {(subject.credits || subject.targetGrade) && (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Course Details</h3>
          <div className="flex gap-6 text-sm">
            {subject.credits && (
              <div>
                <span className="text-[var(--text-muted)]">Credits: </span>
                <span className="text-[var(--text-primary)]">{subject.credits}</span>
              </div>
            )}
            {subject.targetGrade && (
              <div>
                <span className="text-[var(--text-muted)]">Target Grade: </span>
                <span className="text-[var(--text-primary)]">{subject.targetGrade}%</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function AssignmentsTab({
  assignments,
}: {
  assignments: NonNullable<ReturnType<typeof useCourseWorkspace>['data']>['assignments'];
}) {
  const statusColor: Record<string, string> = {
    TODO: 'bg-white/[0.08] text-[var(--text-muted)]',
    IN_PROGRESS: 'bg-[var(--brand)]/10 text-[var(--brand)]',
    BLOCKED: 'bg-red-500/10 text-red-400',
    SUBMITTED: 'bg-teal-500/10 text-teal-400',
    COMPLETED: 'bg-green-500/10 text-green-400',
    ARCHIVED: 'bg-white/[0.04] text-[var(--text-muted)]',
  };

  return (
    <div className="space-y-2">
      {assignments.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)] py-8 text-center">No assignments yet</p>
      ) : (
        assignments.map((a) => (
          <div key={a.id} className="flex items-center justify-between p-4 rounded-xl border border-white/[0.06] bg-white/[0.02]">
            <div className="flex-1">
              <p className="text-sm font-medium text-[var(--text-primary)]">{a.title}</p>
              <div className="flex items-center gap-3 mt-1">
                <span className={`text-xs px-2 py-0.5 rounded-full ${statusColor[a.status] ?? ''}`}>
                  {a.status.replace('_', ' ')}
                </span>
                <span className="text-xs text-[var(--text-muted)]">
                  {a.priority}
                </span>
                {a.dueAt && (
                  <span className="text-xs text-[var(--text-muted)] flex items-center gap-1">
                    <Clock size={12} />
                    {new Date(a.dueAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </span>
                )}
              </div>
            </div>
            {a.grade != null && (
              <span className="text-sm font-semibold text-teal-400">{a.grade}%</span>
            )}
          </div>
        ))
      )}
    </div>
  );
}

function NotesTab({
  notes,
}: {
  notes: NonNullable<ReturnType<typeof useCourseWorkspace>['data']>['notes'];
}) {
  const router = useRouter();
  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {notes.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)] py-8 text-center col-span-full">No notes yet</p>
      ) : (
        notes.map((n) => (
          <button
            key={n.id}
            onClick={() => router.push(`/notes?id=${n.id}`)}
            className="text-left p-4 rounded-xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04] transition-colors"
          >
            <div className="flex items-center gap-2 mb-1">
              {n.pinned && <span className="text-xs">📌</span>}
              {n.favorite && <Star size={12} className="text-amber-400 fill-amber-400" />}
              <p className="text-sm font-medium text-[var(--text-primary)] truncate">{n.title}</p>
            </div>
            {n.excerpt && (
              <p className="text-xs text-[var(--text-muted)] line-clamp-2">{n.excerpt}</p>
            )}
            <p className="text-xs text-[var(--text-muted)] mt-2">
              {new Date(n.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </p>
          </button>
        ))
      )}
    </div>
  );
}

function FlashcardsTab({
  decks,
}: {
  decks: NonNullable<ReturnType<typeof useCourseWorkspace>['data']>['decks'];
}) {
  const router = useRouter();
  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {decks.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)] py-8 text-center col-span-full">No flashcard decks yet</p>
      ) : (
        decks.map((d) => (
          <button
            key={d.id}
            onClick={() => router.push(`/flashcards/${d.id}`)}
            className="text-left p-4 rounded-xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04] transition-colors"
          >
            <p className="text-sm font-medium text-[var(--text-primary)]">{d.title}</p>
            <div className="flex items-center gap-3 mt-2 text-xs text-[var(--text-muted)]">
              <span>{d.cardCount} cards</span>
              <span>{new Date(d.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
            </div>
          </button>
        ))
      )}
    </div>
  );
}

function ScheduleTab({
  schedule,
}: {
  schedule: NonNullable<ReturnType<typeof useCourseWorkspace>['data']>['schedule'];
}) {
  const typeColor: Record<string, string> = {
    CLASS: 'border-l-[var(--brand)]',
    STUDY: 'border-l-teal-400',
    EXAM: 'border-l-red-400',
    FOCUS: 'border-l-violet-400',
    BREAK: 'border-l-white/20',
    PERSONAL: 'border-l-amber-400',
  };

  return (
    <div className="space-y-2">
      {schedule.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)] py-8 text-center">No upcoming schedule</p>
      ) : (
        schedule.map((b) => (
          <div key={b.id} className={`p-4 rounded-xl border border-white/[0.06] bg-white/[0.02] border-l-2 ${typeColor[b.type] ?? ''}`}>
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-[var(--text-primary)]">{b.title}</p>
              <span className="text-xs text-[var(--text-muted)]">{b.type}</span>
            </div>
            <div className="flex items-center gap-3 mt-1 text-xs text-[var(--text-muted)]">
              <span>
                {new Date(b.startAt).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
              </span>
              <span>
                {new Date(b.startAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })}
                {' – '}
                {new Date(b.endAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })}
              </span>
              {b.location && (
                <span className="flex items-center gap-1">
                  <MapPin size={12} /> {b.location}
                </span>
              )}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function GradesTab({
  grades,
  averageGrade,
}: {
  grades: NonNullable<ReturnType<typeof useCourseWorkspace>['data']>['grades'];
  averageGrade: number | null;
}) {
  return (
    <div className="space-y-4">
      {averageGrade != null && (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 flex items-center gap-4">
          <div className="h-14 w-14 rounded-full flex items-center justify-center bg-teal-500/10">
            <span className="text-xl font-bold text-teal-400">{averageGrade}%</span>
          </div>
          <div>
            <p className="text-sm font-semibold text-[var(--text-primary)]">Average Grade</p>
            <p className="text-xs text-[var(--text-muted)]">Across {grades.length} graded items</p>
          </div>
        </div>
      )}
      <div className="space-y-2">
        {grades.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)] py-8 text-center">No grades available</p>
        ) : (
          grades.map((g) => (
            <div key={g.id} className="flex items-center justify-between p-4 rounded-xl border border-white/[0.06] bg-white/[0.02]">
              <div>
                <p className="text-sm font-medium text-[var(--text-primary)]">{g.label}</p>
                {g.postedAt && (
                  <p className="text-xs text-[var(--text-muted)] mt-0.5">
                    {new Date(g.postedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </p>
                )}
              </div>
              <div className="text-right">
                {g.percentage != null ? (
                  <span className="text-sm font-semibold text-teal-400">{g.percentage}%</span>
                ) : g.letterGrade ? (
                  <span className="text-sm font-semibold text-[var(--brand)]">{g.letterGrade}</span>
                ) : g.score != null ? (
                  <span className="text-sm font-semibold text-[var(--text-primary)]">
                    {g.score}{g.maxScore != null ? `/${g.maxScore}` : ''}
                  </span>
                ) : (
                  <span className="text-sm text-[var(--text-muted)]">—</span>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
