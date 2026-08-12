import {
  BookOpen,
  Boxes,
  Brain,
  CheckSquare,
  ClipboardList,
  FileText,
  GraduationCap,
  HelpCircle,
  Lightbulb,
  Link2,
  ListTree,
  Sparkles,
  StickyNote,
} from 'lucide-react';

/**
 * Icon + colour defaults for known node types. Unknown types fall back to
 * generic (topic) styling so AI-generated types don't render as broken.
 */
export const NODE_TYPE_META: Record<
  string,
  { label: string; icon: typeof BookOpen; color: string }
> = {
  root: { label: 'Root', icon: Brain, color: 'var(--color-brand)' },
  topic: { label: 'Topic', icon: ListTree, color: '#38bdf8' },
  subtopic: { label: 'Subtopic', icon: Boxes, color: '#a855f7' },
  concept: { label: 'Concept', icon: Lightbulb, color: '#f59e0b' },
  definition: { label: 'Definition', icon: BookOpen, color: '#14b8a6' },
  example: { label: 'Example', icon: Sparkles, color: '#22c55e' },
  question: { label: 'Question', icon: HelpCircle, color: '#eab308' },
  task: { label: 'Task', icon: CheckSquare, color: '#0ea5e9' },
  resource: { label: 'Resource', icon: Link2, color: '#8b5cf6' },
  note: { label: 'Note', icon: StickyNote, color: '#84cc16' },
  assignment: { label: 'Assignment', icon: ClipboardList, color: '#f97316' },
  subject: { label: 'Subject', icon: GraduationCap, color: '#ec4899' },
  lms_course: { label: 'LMS Course', icon: GraduationCap, color: '#3b82f6' },
  lms_assignment: { label: 'LMS Assignment', icon: FileText, color: '#3b82f6' },
};

export function metaFor(type: string) {
  return NODE_TYPE_META[type] ?? NODE_TYPE_META.topic!;
}
