import 'server-only';

/**
 * The complete set of things an LMS can do. Providers declare which of these
 * they support in `registry.ts`; the sync engine reads that set to decide
 * which adapter methods to call, and the UI reads it to enable/disable
 * feature toggles per connection.
 *
 * Keep this list additive — never remove or rename a capability without
 * migrating the registry entries, or every provider that declared it will
 * silently lose the flag.
 */
export const CAPABILITIES = [
  'COURSES',
  'ASSIGNMENTS',
  'QUIZZES',
  'GRADES',
  'CALENDAR',
  'ANNOUNCEMENTS',
  'FILES',
  'DISCUSSION_FORUMS',
  'ATTENDANCE',
  'MESSAGES',
  'VIDEO_LECTURES',
  'RUBRICS',
  'LEARNING_OUTCOMES',
] as const;

export type Capability = (typeof CAPABILITIES)[number];

/** Human-facing label used in the Provider Health Dashboard capability chips. */
export const CAPABILITY_LABEL: Record<Capability, string> = {
  COURSES: 'Courses',
  ASSIGNMENTS: 'Assignments',
  QUIZZES: 'Quizzes',
  GRADES: 'Grades',
  CALENDAR: 'Calendar',
  ANNOUNCEMENTS: 'Announcements',
  FILES: 'Files',
  DISCUSSION_FORUMS: 'Discussion forums',
  ATTENDANCE: 'Attendance',
  MESSAGES: 'Messages',
  VIDEO_LECTURES: 'Video lectures',
  RUBRICS: 'Rubrics',
  LEARNING_OUTCOMES: 'Learning outcomes',
};

/** Provider lifecycle status shown in the Provider Health Dashboard. */
export type ProviderStatus = 'LIVE' | 'IN_DEVELOPMENT' | 'PLANNED' | 'UNSUPPORTED';

export const PROVIDER_STATUS_LABEL: Record<ProviderStatus, string> = {
  LIVE: 'Live',
  IN_DEVELOPMENT: 'In development',
  PLANNED: 'Planned',
  UNSUPPORTED: 'Unsupported',
};
