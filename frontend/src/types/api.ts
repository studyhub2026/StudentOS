/**
 * Mirrors the server's response envelope and Prisma models.
 *
 * These types are hand-maintained against `src/server`. When a route's
 * response shape changes, update it here in the same commit — this file is the
 * contract the whole client compiles against.
 */

export interface ApiEnvelope<T> {
  success: true;
  data: T;
}

export interface ApiPaginatedEnvelope<T> extends ApiEnvelope<T[]> {
  pagination: Pagination;
}

export interface ApiErrorBody {
  success: false;
  error: {
    code: string;
    message: string;
    details?: { path: string; message: string }[];
  };
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrevious: boolean;
}

export type Role = 'STUDENT' | 'TEACHER' | 'ADMIN';

export type AssignmentStatus =
  | 'TODO'
  | 'IN_PROGRESS'
  | 'BLOCKED'
  | 'SUBMITTED'
  | 'COMPLETED'
  | 'ARCHIVED';

export type Priority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';

export type Recurrence = 'DAILY' | 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY';

export interface User {
  id: string;
  email: string;
  username: string;
  name: string;
  avatarUrl: string | null;
  role: Role;
  emailVerified: boolean;
  twoFactorEnabled: boolean;
  currentStreak: number;
  totalXp: number;
  coins: number;
  level: number;
  createdAt: string;
}

export interface AuthPayload {
  user: User;
  accessToken: string;
  expiresIn: number;
}

export interface SubjectRef {
  id: string;
  name: string;
  color: string;
  code: string | null;
}

export interface Subject {
  id: string;
  name: string;
  code: string | null;
  color: string;
  icon: string | null;
  teacherName: string | null;
  room: string | null;
  credits: number | null;
  targetGrade: number | null;
  archived: boolean;
  createdAt: string;
  assignmentCount: number;
  openAssignmentCount: number;
}

export interface Attachment {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
}

export interface Assignment {
  id: string;
  title: string;
  description: string | null;
  status: AssignmentStatus;
  priority: Priority;
  dueAt: string | null;
  startAt: string | null;
  completedAt: string | null;
  estimatedMinutes: number | null;
  actualMinutes: number;
  progress: number;
  grade: number | null;
  maxGrade: number | null;
  weight: number | null;
  labels: string[];
  recurrence: Recurrence | null;
  reminderAt: string | null;
  createdAt: string;
  updatedAt: string;
  subjectId: string | null;
  subject: SubjectRef | null;
  attachments: Attachment[];
  _count: { occurrences: number };
}

export interface AssignmentStats {
  total: number;
  completed: number;
  overdue: number;
  dueToday: number;
  dueThisWeek: number;
  completionRate: number;
  byStatus: Record<string, number>;
  byPriority: Record<string, number>;
}

export interface StudyTrendPoint {
  date: string;
  studyMinutes: number;
  assignmentsCompleted: number;
  productivityScore: number;
}

export interface SubjectBreakdown {
  subjectId: string;
  name: string;
  color: string;
  studyMinutes: number;
  assignmentCount: number;
  completedCount: number;
}

export interface ScheduleBlockSummary {
  id: string;
  title: string;
  type: string;
  startAt: string;
  endAt: string;
  location: string | null;
  color: string | null;
  subject: { name: string; color: string } | null;
}

export interface DashboardOverview {
  stats: {
    studyMinutesToday: number;
    studyMinutesWeek: number;
    currentStreak: number;
    longestStreak: number;
    totalXp: number;
    productivityScore: number;
    focusSessionsToday: number;
    cardsDueToday: number;
  };
  assignments: AssignmentStats;
  upcoming: Assignment[];
  todaySchedule: ScheduleBlockSummary[];
  trend: StudyTrendPoint[];
  subjectBreakdown: SubjectBreakdown[];
}

export interface SessionSummary {
  id: string;
  userAgent: string | null;
  ipAddress: string | null;
  lastSeenAt: string;
  createdAt: string;
  expiresAt: string;
  current: boolean;
}

/** Query parameters accepted by GET /assignments. */
export interface AssignmentFilters {
  page?: number;
  limit?: number;
  sortBy?: 'dueAt' | 'createdAt' | 'updatedAt' | 'priority' | 'title' | 'status';
  sortOrder?: 'asc' | 'desc';
  status?: AssignmentStatus[];
  priority?: Priority[];
  subjectId?: string;
  labels?: string[];
  search?: string;
  dueBefore?: string;
  dueAfter?: string;
  overdue?: boolean;
  includeCompleted?: boolean;
  includeArchived?: boolean;
}

export interface CreateAssignmentBody {
  title: string;
  description?: string;
  subjectId?: string | null;
  status?: AssignmentStatus;
  priority?: Priority;
  dueAt?: string | null;
  startAt?: string | null;
  estimatedMinutes?: number | null;
  maxGrade?: number | null;
  weight?: number | null;
  labels?: string[];
  recurrence?: Recurrence | null;
  recurrenceUntil?: string | null;
  reminderAt?: string | null;
}

export type UpdateAssignmentBody = Partial<CreateAssignmentBody> & {
  progress?: number;
  actualMinutes?: number;
  grade?: number | null;
};

// --- Notes ------------------------------------------------------------------

export type NoteView = 'active' | 'favorites' | 'archived' | 'trash';
export type SharePermission = 'VIEW' | 'COMMENT' | 'EDIT';

export interface NoteFolder {
  id: string;
  name: string;
  color: string | null;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
  noteCount: number;
}

export interface Note {
  id: string;
  title: string;
  content: string;
  contentJson: unknown;
  excerpt: string | null;
  tags: string[];
  pinned: boolean;
  favorite: boolean;
  wordCount: number;
  aiSummary: string | null;
  aiSummaryAt: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  deletedAt: string | null;
  folderId: string | null;
  subjectId: string | null;
  subject: { id: string; name: string; color: string } | null;
  folder: { id: string; name: string; color: string | null } | null;
  attachments: Attachment[];
  _count: { versions: number; shares: number };
}

export interface NoteVersion {
  id: string;
  version: number;
  title: string;
  wordCount: number;
  automatic: boolean;
  createdAt: string;
}

export interface NoteShare {
  id: string;
  permission: SharePermission;
  linkToken: string | null;
  expiresAt: string | null;
  createdAt: string;
  sharedWith: { id: string; name: string; username: string; avatarUrl: string | null } | null;
}

export interface NoteFilters {
  page?: number;
  limit?: number;
  sortBy?: 'updatedAt' | 'createdAt' | 'title' | 'wordCount';
  sortOrder?: 'asc' | 'desc';
  view?: NoteView;
  folderId?: string;
  subjectId?: string;
  search?: string;
  tags?: string[];
}

export interface CreateNoteBody {
  title: string;
  content?: string;
  tags?: string[];
  folderId?: string | null;
  subjectId?: string | null;
  favorite?: boolean;
}

export type UpdateNoteBody = Partial<CreateNoteBody> & { pinned?: boolean };

export interface NoteSummaryResult {
  summary: string;
  keyPoints: string[];
  model: string;
  totalTokens: number;
}

// --- Flashcards -------------------------------------------------------------

export type CardDifficulty = 'EASY' | 'MEDIUM' | 'HARD';
export type CardState = 'NEW' | 'LEARNING' | 'REVIEW' | 'RELEARNING';
export type ReviewRating = 'again' | 'hard' | 'good' | 'easy';

export interface Deck {
  id: string;
  name: string;
  description: string | null;
  color: string;
  isPublic: boolean;
  generatedByAi: boolean;
  createdAt: string;
  updatedAt: string;
  subject: { id: string; name: string; color: string } | null;
  totalCards: number;
  dueCards: number;
  newCards: number;
  matureCards: number;
}

export interface Flashcard {
  id: string;
  deckId: string;
  front: string;
  back: string;
  hint: string | null;
  tags: string[];
  difficulty: CardDifficulty;
  suspended: boolean;
  generatedByAi: boolean;
  state: CardState;
  easeFactor: number;
  intervalDays: number;
  repetitions: number;
  lapses: number;
  dueAt: string;
  lastReviewedAt: string | null;
  createdAt: string;
}

export interface ReviewCard {
  id: string;
  front: string;
  back: string;
  hint: string | null;
  tags: string[];
  difficulty: CardDifficulty;
  state: CardState;
  intervalDays: number;
  repetitions: number;
  lapses: number;
  intervalPreview: Record<ReviewRating, number>;
}

export interface ReviewOutcome {
  cardId: string;
  passed: boolean;
  intervalDays: number;
  dueAt: string;
  easeFactor: number;
}

export interface FlashcardStats {
  totalCards: number;
  dueToday: number;
  newCards: number;
  matureCards: number;
  learningCards: number;
  suspendedCards: number;
  reviewsToday: number;
  reviewsTotal: number;
  retentionRate: number;
  averageEase: number;
  heatmap: { date: string; count: number }[];
  forecast: { date: string; count: number }[];
}

export interface CardFilters {
  page?: number;
  limit?: number;
  sortBy?: 'createdAt' | 'dueAt' | 'front' | 'intervalDays' | 'lapses';
  sortOrder?: 'asc' | 'desc';
  difficulty?: CardDifficulty[];
  state?: CardState[];
  suspended?: boolean;
  search?: string;
  tags?: string[];
}

export interface CreateDeckBody {
  name: string;
  description?: string | null;
  color?: string;
  subjectId?: string | null;
  sourceNoteId?: string | null;
}

export interface CreateCardBody {
  front: string;
  back: string;
  hint?: string | null;
  tags?: string[];
  difficulty?: CardDifficulty;
}

export interface GeneratedCard {
  front: string;
  back: string;
  hint: string | null;
  difficulty: CardDifficulty;
}

export interface GenerateCardsResult {
  cards: GeneratedCard[];
  saved: number;
  model: string;
  totalTokens: number;
}

// --- Schedule / Focus / Analytics -------------------------------------------

export type ScheduleBlockType = 'CLASS' | 'STUDY' | 'FOCUS' | 'EXAM' | 'BREAK' | 'PERSONAL';
export type StudySessionType = 'POMODORO' | 'DEEP_WORK' | 'REVIEW' | 'CLASS' | 'BREAK';

export interface ScheduleBlock {
  id: string;
  title: string;
  type: ScheduleBlockType;
  startAt: string;
  endAt: string;
  location: string | null;
  notes: string | null;
  color: string | null;
  locked: boolean;
  aiGenerated: boolean;
  subjectId: string | null;
  assignmentId: string | null;
  subject: { id: string; name: string; color: string } | null;
  assignment: { id: string; title: string; status: AssignmentStatus } | null;
}

export interface WeekSchedule {
  weekStart: string;
  days: { date: string; blocks: ScheduleBlock[] }[];
  totalBlocks: number;
}

export interface CreateBlockBody {
  title: string;
  type?: ScheduleBlockType;
  startAt: string;
  endAt: string;
  location?: string | null;
  notes?: string | null;
  color?: string | null;
  subjectId?: string | null;
  assignmentId?: string | null;
  recurrence?: Recurrence | null;
  recurrenceUntil?: string | null;
  allowOverlap?: boolean;
}

export interface PlanSession {
  taskId: string;
  title: string;
  subjectId: string | null | undefined;
  startAt: string;
  endAt: string;
  minutes: number;
  date: string;
}

export interface StudyPlan {
  generatedAt: string;
  range: { from: string; to: string };
  sessions: PlanSession[];
  unscheduled: { id: string; title: string; estimatedMinutes: number }[];
  totalMinutes: number;
  advice: string | null;
  aiModel: string | null;
}

export interface FocusSession {
  id: string;
  type: StudySessionType;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number;
  completed: boolean;
  interruptions: number;
  focusScore: number | null;
  ambientSound: string | null;
  notes: string | null;
  subject: { id: string; name: string; color: string } | null;
  assignment: { id: string; title: string } | null;
}

export interface Analytics {
  range: { from: string; to: string; days: number };
  totals: {
    studyMinutes: number;
    focusMinutes: number;
    sessions: number;
    assignmentsCompleted: number;
    cardsReviewed: number;
    notesCreated: number;
    xpEarned: number;
  };
  averages: {
    minutesPerDay: number;
    minutesPerActiveDay: number;
    sessionLengthMinutes: number;
    productivityScore: number;
  };
  streak: { current: number; longest: number };
  burnout: { atRisk: boolean; reason: string | null; consecutiveDays: number };
  daily: {
    date: string;
    studyMinutes: number;
    focusMinutes: number;
    assignmentsCompleted: number;
    cardsReviewed: number;
    productivityScore: number;
  }[];
  weekdayHeatmap: { weekday: number; hour: number; minutes: number }[];
  subjects: {
    subjectId: string;
    name: string;
    color: string;
    studyMinutes: number;
    assignmentsTotal: number;
    assignmentsCompleted: number;
    completionRate: number;
    averageGrade: number | null;
  }[];
  grades: {
    overallAverage: number | null;
    gpa: number | null;
    bySubject: { subjectId: string; name: string; average: number; credits: number | null }[];
  };
  weakSubjects: { subjectId: string; name: string; reason: string }[];
}

// --- Admin ------------------------------------------------------------------

export interface AdminOverview {
  users: {
    total: number;
    active7d: number;
    active30d: number;
    newThisWeek: number;
    byRole: Record<string, number>;
    verified: number;
    withTwoFactor: number;
    suspended: number;
  };
  content: {
    assignments: number;
    notes: number;
    decks: number;
    flashcards: number;
    studyGroups: number;
    messages: number;
    aiConversations: number;
  };
  activity: {
    studyHours30d: number;
    sessions30d: number;
    reviews30d: number;
    aiMessages30d: number;
  };
  signups: { date: string; count: number }[];
  topSubjects: { name: string; count: number }[];
}

export interface AdminUser {
  id: string;
  email: string;
  username: string;
  name: string;
  avatarUrl: string | null;
  role: Role;
  emailVerified: boolean;
  twoFactorEnabled: boolean;
  currentStreak: number;
  totalXp: number;
  createdAt: string;
  lastActiveDate: string | null;
  deletedAt: string | null;
  counts: { assignments: number; notes: number; decks: number; sessions: number };
}

export interface AdminUserDetail extends Omit<AdminUser, 'counts'> {
  bio: string | null;
  longestStreak: number;
  updatedAt: string;
  accounts: { provider: string; createdAt: string }[];
  sessions: {
    id: string;
    userAgent: string | null;
    ipAddress: string | null;
    lastSeenAt: string;
  }[];
  counts: {
    assignments: number;
    notes: number;
    decks: number;
    studySessions: number;
    aiConversations: number;
    groupMemberships: number;
  };
}

export interface AdminMessage {
  id: string;
  content: string;
  createdAt: string;
  author: { id: string; name: string; username: string; avatarUrl: string | null };
  channel: { id: string; name: string; group: { id: string; name: string } | null };
}

export interface AdminGroup {
  id: string;
  name: string;
  slug: string;
  isPublic: boolean;
  createdAt: string;
  owner: { id: string; name: string; username: string };
  _count: { members: number; channels: number };
}

export interface ActivityLogEntry {
  id: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  metadata: unknown;
  ipAddress: string | null;
  createdAt: string;
  user: { id: string; name: string; username: string } | null;
}

export interface SystemHealth {
  uptimeSeconds: number;
  nodeVersion: string;
  environment: string;
  memory: { rssMb: number; heapUsedMb: number; heapTotalMb: number };
  database: { reachable: boolean; latencyMs: number | null };
  integrations: {
    gemini: boolean;
    cloudinary: boolean;
    redis: boolean;
    oauth: string[];
  };
}

// --- Study group chat -------------------------------------------------------

export interface GroupSummary {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  avatarUrl: string | null;
  isPublic: boolean;
  maxMembers: number;
  createdAt: string;
  owner: { id: string; name: string; username: string };
  memberCount: number;
  channelCount: number;
  myRole: GroupRole;
  joinedAt: string;
}

export type GroupRole = 'OWNER' | 'MODERATOR' | 'MEMBER';

export interface GroupMember {
  id: string;
  role: GroupRole;
  joinedAt: string;
  user: { id: string; name: string; username: string; avatarUrl: string | null };
}

export interface GroupChannel {
  id: string;
  name: string;
  type: 'TEXT' | 'ANNOUNCEMENT' | 'DIRECT';
  topic: string | null;
  createdAt: string;
}

export interface GroupDetail {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  avatarUrl: string | null;
  isPublic: boolean;
  inviteCode: string;
  maxMembers: number;
  createdAt: string;
  ownerId: string;
  owner: { id: string; name: string; username: string; avatarUrl: string | null };
  members: GroupMember[];
  channels: GroupChannel[];
}

export interface ChatMessage {
  id: string;
  content: string;
  createdAt: string;
  editedAt?: string | null;
  replyToId: string | null;
  author: { id: string; name: string; username: string; avatarUrl: string | null };
  attachments?: Attachment[];
}

export interface MessagePage {
  messages: ChatMessage[];
  hasMore: boolean;
  nextCursor: string | null;
}

export interface PublicGroup {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  avatarUrl: string | null;
  maxMembers: number;
  memberCount: number;
}

// --- Uploads ----------------------------------------------------------------

export type UploadFolder = 'avatars' | 'assignments' | 'notes' | 'messages' | 'courses';

export interface SignedUpload {
  signature: string;
  timestamp: number;
  apiKey: string;
  cloudName: string;
  folder: string;
  publicId: string;
  uploadUrl: string;
  maxBytes: number;
  allowedFormats: string[];
}

export interface CreateSubjectBody {
  name: string;
  code?: string | null;
  color?: string;
  icon?: string | null;
  teacherName?: string | null;
  room?: string | null;
  credits?: number | null;
  targetGrade?: number | null;
}

// --- University LMS Integration ----------------------------------------------

export type LmsProvider =
  | 'MOODLE'
  | 'BLACKBOARD'
  | 'CANVAS'
  | 'BRIGHTSPACE'
  | 'SAKAI'
  | 'GOOGLE_CLASSROOM'
  | 'MS_TEAMS';

export type LmsConnectionStatus = 'CONNECTED' | 'DISCONNECTED' | 'ERROR' | 'SYNCING';

export type SyncStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';

export interface LmsConnection {
  id: string;
  provider: LmsProvider;
  displayName: string;
  portalUrl: string;
  status: LmsConnectionStatus;
  statusDetail: string | null;
  autoSync: boolean;
  syncInterval: number;
  importGrades: boolean;
  importCalendar: boolean;
  importFiles: boolean;
  lastSyncAt: string | null;
  tokenExpiresAt: string | null;
  adapterVersion: string;
  // Raw profile blob cached from the last successful sync. Includes provider
  // fields (name, email, studentId, avatarUrl) plus a namespaced OmnelOS
  // authMode marker so the UI can show "Web Service Token" vs "Username +
  // Password → Token" on the connection card.
  profileData: Record<string, unknown> | null;
  remoteUserId: string | null;
  createdAt: string;
  updatedAt: string;
  _count: {
    courses: number;
    assignments: number;
    exams: number;
    announcements: number;
    grades: number;
    files: number;
    conflicts: number;
  };
}


export interface UniversityDashboard {
  connections: number;
  courses: number;
  assignments: number;
  exams: number;
  announcements: number;
  grades: number;
  files: number;
  lastSyncAt: string | null;
  syncErrors: number;
  pendingConflicts: number;
  pendingPreviews: number;
  queue?: {
    active: number;
    waiting: number;
    completed: number;
    failed: number;
    delayed: number;
  };
}

export interface QueueStatus {
  enabled: boolean;
  redis: { ok: boolean; latencyMs?: number; error?: string; note?: string };
  counts: {
    active: number;
    waiting: number;
    completed: number;
    failed: number;
    delayed: number;
  } | null;
  workerMode: 'in-web' | 'standalone';
}

export interface OAuthStartResponse {
  connectionId: string;
  authorizeUrl: string;
}

export interface SyncLog {
  id: string;
  connectionId: string;
  status: SyncStatus;
  startedAt: string;
  endedAt: string | null;
  coursesFound: number;
  assignmentsFound: number;
  examsFound: number;
  announcementsFound: number;
  gradesFound: number;
  filesFound: number;
  coursesCreated: number;
  coursesUpdated: number;
  assignmentsCreated: number;
  assignmentsUpdated: number;
  examsCreated: number;
  examsUpdated: number;
  announcementsCreated: number;
  announcementsUpdated: number;
  gradesCreated: number;
  gradesUpdated: number;
  filesCreated: number;
  filesUpdated: number;
  // Extended metrics (populated by the sync engine).
  skippedRecords: number;
  duplicateRecords: number;
  deletedRecords: number;
  failedRecords: number;
  apiRequestsMade: number;
  avgResponseTimeMs: number;
  queueWaitMs: number;
  queueExecutionMs: number;
  dryRun: boolean;
  errors: string | null;
  connection: { displayName: string; provider: LmsProvider };
}

export interface LmsCourse {
  id: string;
  externalId: string;
  name: string;
  code: string | null;
  instructor: string | null;
  term: string | null;
  active: boolean;
  connection: { displayName: string; provider: LmsProvider };
  _count: { assignments: number; exams: number; announcements: number; files: number };
}

export interface LmsAnnouncementItem {
  id: string;
  title: string;
  body: string | null;
  author: string | null;
  postedAt: string | null;
  url: string | null;
  course: { name: string };
}

export interface LmsGradeItem {
  id: string;
  label: string;
  score: number | null;
  maxScore: number | null;
  percentage: number | null;
  letterGrade: string | null;
  postedAt: string | null;
  course: { name: string };
}

export interface LmsFileItem {
  id: string;
  filename: string;
  mimeType: string | null;
  sizeBytes: number | null;
  externalUrl: string | null;
  course: { name: string };
}

export interface CreateConnectionBody {
  provider: LmsProvider;
  displayName: string;
  portalUrl: string;
  apiKey?: string;
  accessToken?: string;
  refreshToken?: string;
  autoSync?: boolean;
  syncInterval?: number;
  importGrades?: boolean;
  importCalendar?: boolean;
  importFiles?: boolean;
}

// --- LMS Registry (provider-independent architecture) ------------------------

export type LmsAuthMode = 'oauth' | 'token';
export type LmsProviderStatus = 'LIVE' | 'IN_DEVELOPMENT' | 'PLANNED' | 'UNSUPPORTED';
export type LmsCapability =
  | 'COURSES'
  | 'ASSIGNMENTS'
  | 'QUIZZES'
  | 'GRADES'
  | 'CALENDAR'
  | 'ANNOUNCEMENTS'
  | 'FILES'
  | 'DISCUSSION_FORUMS'
  | 'ATTENDANCE'
  | 'MESSAGES'
  | 'VIDEO_LECTURES'
  | 'RUBRICS'
  | 'LEARNING_OUTCOMES';

export interface LmsProviderPublicMeta {
  id: LmsProvider;
  slug: string;
  displayName: string;
  icon: string;
  color: string;
  authMode: LmsAuthMode;
  adapterVersion: string;
  status: LmsProviderStatus;
  capabilities: LmsCapability[];
  documentationUrl: string;
  notes?: string;
  ready: boolean;
  readyReason?: string;
}

// --- Diagnostics -------------------------------------------------------------

export interface Diagnostics {
  connections: {
    id: string;
    provider: LmsProvider;
    displayName: string;
    portalUrl: string;
    status: LmsConnectionStatus;
    statusDetail: string | null;
    adapterVersion: string;
    lastSyncAt: string | null;
    tokenExpiresAt: string | null;
    autoSync: boolean;
    syncInterval: number;
    lastSuccessfulSync: {
      startedAt: string;
      endedAt: string | null;
      apiRequestsMade: number;
      avgResponseTimeMs: number;
      queueWaitMs: number;
      queueExecutionMs: number;
    } | null;
    lastFailedSync: { startedAt: string; errors: string | null } | null;
    totalFailedSyncs: number;
    avgApiResponseMs: number;
    avgQueueWaitMs: number;
    avgQueueExecutionMs: number;
  }[];
  recentErrors: {
    id: string;
    startedAt: string;
    errors: string | null;
    connection: { displayName: string; provider: LmsProvider };
  }[];
  infrastructure: {
    postgres: { ok: boolean; error?: string };
    redis: { ok: boolean; latencyMs?: number; error?: string; note?: string };
    queue: {
      active: number;
      waiting: number;
      completed: number;
      failed: number;
      delayed: number;
    } | null;
    workerMode: 'in-web' | 'standalone';
  };
  providers: LmsProviderPublicMeta[];
}

// --- Preview / Dry-run -------------------------------------------------------

export type LmsSyncPreviewStatus = 'PENDING' | 'APPROVED' | 'CANCELLED' | 'EXPIRED';

export interface SyncPlanSample {
  externalId: string;
  label: string;
  courseName?: string;
}

export interface EntityPlan {
  new: SyncPlanSample[];
  updated: SyncPlanSample[];
  deleted: SyncPlanSample[];
  duplicate: SyncPlanSample[];
}

export interface SyncPlan {
  courses: EntityPlan;
  assignments: EntityPlan;
  exams: EntityPlan;
  announcements: EntityPlan;
  grades: EntityPlan;
  files: EntityPlan;
}

export interface PlanEstimates {
  durationSec: number;
  aiCostUsd: number;
  storageMb: number;
  records: number;
}

export interface SyncPreview {
  id: string;
  connectionId: string;
  status: LmsSyncPreviewStatus;
  plan: SyncPlan;
  estimates: PlanEstimates;
  createdAt: string;
  expiresAt: string;
  approvedAt: string | null;
  cancelledAt: string | null;
  connection: { displayName: string; provider: LmsProvider; portalUrl?: string };
}

// --- Conflicts ---------------------------------------------------------------

export type LmsConflictStatus = 'PENDING' | 'RESOLVED' | 'IGNORED';
export type ResolutionAction = 'KEEP_LOCAL' | 'KEEP_REMOTE' | 'MERGE' | 'IGNORE';

export interface ConflictResolutionRecord {
  id: string;
  action: ResolutionAction | 'UNDONE';
  data: Record<string, unknown> | null;
  createdAt: string;
}

export interface Conflict {
  id: string;
  connectionId: string;
  entityType: string;
  entityId: string;
  localData: Record<string, unknown>;
  remoteData: Record<string, unknown>;
  ancestorData: Record<string, unknown> | null;
  status: LmsConflictStatus;
  detectedAt: string;
  resolvedAt: string | null;
  connection: { id: string; displayName: string; provider: LmsProvider };
  resolutions: ConflictResolutionRecord[];
}
