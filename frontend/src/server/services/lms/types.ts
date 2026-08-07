import 'server-only';
import type { LmsProvider } from '@prisma/client';

/**
 * Shared LMS adapter contract. Every provider (Canvas, Moodle, Blackboard, …)
 * implements this interface so `universitySyncService` never branches per
 * provider. New providers plug in through the factory.
 *
 * Adapters are stateless: tokens are passed in, refreshed tokens are returned.
 * The caller (sync worker) is responsible for persisting rotated tokens.
 */

export interface LmsTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
}

export interface LmsRefreshResult {
  tokens: LmsTokens;
  /** True if `refreshToken` rotated as well. */
  rotated: boolean;
}

export interface LmsProfile {
  remoteUserId: string;
  name: string;
  email?: string;
  studentId?: string;
  program?: string;
  faculty?: string;
  department?: string;
  academicYear?: string;
  semester?: string;
  avatarUrl?: string;
  /** Raw provider payload for future features that need extra fields. */
  raw?: Record<string, unknown>;
}

export interface ExternalCourse {
  externalId: string;
  name: string;
  code?: string;
  instructor?: string;
  term?: string;
  active: boolean;
  remoteUpdatedAt?: Date;
}

export interface ExternalAssignment {
  externalId: string;
  courseExternalId: string;
  title: string;
  description?: string;
  dueAt?: Date;
  points?: number;
  maxPoints?: number;
  type?: string;
  url?: string;
  submitted: boolean;
  remoteUpdatedAt?: Date;
}

export interface ExternalExam {
  externalId: string;
  courseExternalId: string;
  title: string;
  description?: string;
  scheduledAt?: Date;
  durationMinutes?: number;
  location?: string;
  url?: string;
  remoteUpdatedAt?: Date;
}

export interface ExternalAnnouncement {
  externalId: string;
  courseExternalId: string;
  title: string;
  body?: string;
  author?: string;
  postedAt?: Date;
  url?: string;
  remoteUpdatedAt?: Date;
}

export interface ExternalGrade {
  externalId: string;
  courseExternalId: string;
  assignmentExternalId?: string;
  label: string;
  score?: number;
  maxScore?: number;
  percentage?: number;
  letterGrade?: string;
  postedAt?: Date;
}

export interface ExternalFile {
  externalId: string;
  courseExternalId: string;
  filename: string;
  mimeType?: string;
  sizeBytes?: number;
  url?: string;
  remoteUpdatedAt?: Date;
}

export interface ExternalCalendarEvent {
  externalId: string;
  courseExternalId?: string;
  title: string;
  description?: string;
  startAt: Date;
  endAt?: Date;
  location?: string;
  type: 'lecture' | 'lab' | 'exam' | 'office_hours' | 'deadline' | 'other';
  url?: string;
}

export interface FetchOptions {
  /** Provider-side filter for records changed after this time (best-effort). */
  since?: Date;
}

export interface LmsAdapter {
  readonly provider: LmsProvider;
  /** Semver — must match the entry in registry.ts for this provider. */
  readonly version: string;

  /** Full URL to redirect the user to for the OAuth2 authorize step. */
  getAuthorizeUrl(state: string): string;

  /** Exchange the OAuth2 `code` for an initial access + refresh token pair. */
  authenticate(code: string): Promise<LmsTokens>;

  /** Rotate the access token using a refresh token. */
  refresh(refreshToken: string): Promise<LmsRefreshResult>;

  /** Revoke the given token pair at the provider (best-effort). */
  revoke(tokens: LmsTokens): Promise<void>;

  getProfile(tokens: LmsTokens): Promise<LmsProfile>;
  getCourses(tokens: LmsTokens, opts?: FetchOptions): Promise<ExternalCourse[]>;
  getAssignments(tokens: LmsTokens, courseExternalId: string, opts?: FetchOptions): Promise<ExternalAssignment[]>;
  getExams(tokens: LmsTokens, courseExternalId: string, opts?: FetchOptions): Promise<ExternalExam[]>;
  getAnnouncements(tokens: LmsTokens, courseExternalId: string, opts?: FetchOptions): Promise<ExternalAnnouncement[]>;
  getGrades(tokens: LmsTokens, courseExternalId: string, opts?: FetchOptions): Promise<ExternalGrade[]>;
  getFiles(tokens: LmsTokens, courseExternalId: string, opts?: FetchOptions): Promise<ExternalFile[]>;
  getCalendar(tokens: LmsTokens, courseExternalId: string, opts?: FetchOptions): Promise<ExternalCalendarEvent[]>;
}

/** Config passed to adapters at construction time. */
export interface AdapterConfig {
  /** Base URL of the institution's LMS instance, e.g. https://canvas.university.edu */
  portalUrl: string;
  /** Full URL Canvas/etc will redirect back to after OAuth. */
  redirectUri: string;
  /** The single developer key for this app at this provider. */
  clientId: string;
  clientSecret: string;
}

export class LmsProviderError extends Error {
  readonly provider: LmsProvider;
  readonly status?: number;
  readonly retryable: boolean;

  constructor(provider: LmsProvider, message: string, status?: number, retryable = false) {
    super(`[${provider}] ${message}`);
    this.name = 'LmsProviderError';
    this.provider = provider;
    this.status = status;
    this.retryable = retryable;
  }
}
