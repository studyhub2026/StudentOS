import 'server-only';
import { LmsProvider } from '@prisma/client';
import { logger } from '@/server/lib/logger';
import type {
  AdapterConfig,
  ExternalAnnouncement,
  ExternalAssignment,
  ExternalCalendarEvent,
  ExternalCourse,
  ExternalExam,
  ExternalFile,
  ExternalGrade,
  FetchOptions,
  LmsAdapter,
  LmsProfile,
  LmsRefreshResult,
  LmsTokens,
} from './types';
import { LmsProviderError } from './types';
import type { SyncMetrics } from './metrics';

/**
 * Canvas LMS adapter — real implementation against the Canvas REST API v1.
 * https://canvas.instructure.com/doc/api/
 *
 * OAuth2 flow:
 *  1. Redirect user to `{portalUrl}/login/oauth2/auth` with client_id + state.
 *  2. Callback receives ?code=…&state=… → POST to `/login/oauth2/token` to get
 *     access_token + refresh_token.
 *  3. Refresh via POST /login/oauth2/token with grant_type=refresh_token.
 *
 * All list endpoints use Link-header pagination (RFC 5988). We follow `rel="next"`
 * until exhausted, with per_page=100 to minimise round trips.
 *
 * Rate limiting: Canvas returns 403 with X-Rate-Limit-Remaining ≤ 0 or 429.
 * We back off exponentially up to 3 in-adapter retries before surfacing an
 * LmsProviderError(retryable=true) so the BullMQ worker can requeue.
 */

const CANVAS_SCOPES = [
  'url:GET|/api/v1/users/self',
  'url:GET|/api/v1/users/self/profile',
  'url:GET|/api/v1/courses',
  'url:GET|/api/v1/courses/:course_id/assignments',
  'url:GET|/api/v1/courses/:course_id/discussion_topics',
  'url:GET|/api/v1/courses/:course_id/files',
  'url:GET|/api/v1/courses/:course_id/enrollments',
  'url:GET|/api/v1/users/self/enrollments',
  'url:GET|/api/v1/calendar_events',
].join(' ');

interface CanvasCourse {
  id: number;
  name: string;
  course_code?: string;
  workflow_state?: string;
  enrollment_term_id?: number;
  term?: { name?: string };
  teachers?: { display_name?: string }[];
  updated_at?: string;
}

interface CanvasAssignment {
  id: number;
  name: string;
  description?: string | null;
  due_at?: string | null;
  points_possible?: number | null;
  submission_types?: string[];
  html_url?: string;
  has_submitted_submissions?: boolean;
  updated_at?: string;
}

interface CanvasDiscussionTopic {
  id: number;
  title: string;
  message?: string | null;
  author?: { display_name?: string } | null;
  posted_at?: string | null;
  html_url?: string;
  updated_at?: string;
}

interface CanvasCalendarEvent {
  id: number | string;
  title: string;
  description?: string | null;
  start_at?: string | null;
  end_at?: string | null;
  location_name?: string | null;
  html_url?: string;
  context_code?: string;
  type?: string;
  workflow_state?: string;
}

interface CanvasFile {
  id: number;
  display_name?: string;
  filename?: string;
  'content-type'?: string;
  size?: number;
  url?: string;
  updated_at?: string;
}

interface CanvasEnrollment {
  id: number;
  course_id: number;
  grades?: {
    current_score?: number | null;
    current_grade?: string | null;
    final_score?: number | null;
    final_grade?: string | null;
  };
  updated_at?: string;
}

interface CanvasProfile {
  id: number;
  name?: string;
  short_name?: string;
  primary_email?: string;
  sis_user_id?: string | null;
  login_id?: string;
  avatar_url?: string;
}

export class CanvasAdapter implements LmsAdapter {
  readonly provider = LmsProvider.CANVAS;
  readonly version = '1.0.0';
  private readonly cfg: AdapterConfig;
  private readonly metrics?: SyncMetrics;

  constructor(cfg: AdapterConfig, metrics?: SyncMetrics) {
    this.cfg = cfg;
    this.metrics = metrics;
  }

  // --- OAuth2 --------------------------------------------------------------

  getAuthorizeUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.cfg.clientId,
      response_type: 'code',
      redirect_uri: this.cfg.redirectUri,
      state,
      scope: CANVAS_SCOPES,
    });
    return `${this.cfg.portalUrl}/login/oauth2/auth?${params.toString()}`;
  }

  async authenticate(code: string): Promise<LmsTokens> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: this.cfg.clientId,
      client_secret: this.cfg.clientSecret,
      redirect_uri: this.cfg.redirectUri,
      code,
    });
    const res = await fetch(`${this.cfg.portalUrl}/login/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) {
      throw new LmsProviderError(
        this.provider,
        `token exchange failed (${res.status}): ${(await res.text()).slice(0, 300)}`,
        res.status,
      );
    }
    const json = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };
    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      expiresAt: json.expires_in ? new Date(Date.now() + json.expires_in * 1000) : undefined,
    };
  }

  async refresh(refreshToken: string): Promise<LmsRefreshResult> {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: this.cfg.clientId,
      client_secret: this.cfg.clientSecret,
      refresh_token: refreshToken,
    });
    const res = await fetch(`${this.cfg.portalUrl}/login/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) {
      throw new LmsProviderError(
        this.provider,
        `refresh failed (${res.status}): ${(await res.text()).slice(0, 300)}`,
        res.status,
      );
    }
    const json = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };
    // Canvas rotates refresh tokens on some deployments and reuses on others.
    const rotated = Boolean(json.refresh_token && json.refresh_token !== refreshToken);
    return {
      tokens: {
        accessToken: json.access_token,
        refreshToken: json.refresh_token ?? refreshToken,
        expiresAt: json.expires_in ? new Date(Date.now() + json.expires_in * 1000) : undefined,
      },
      rotated,
    };
  }

  async revoke(tokens: LmsTokens): Promise<void> {
    // Canvas: DELETE /login/oauth2/token removes the tokens for this app.
    try {
      await fetch(`${this.cfg.portalUrl}/login/oauth2/token`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      });
    } catch (err) {
      logger.warn({ err }, 'canvas: revoke failed (non-fatal)');
    }
  }

  // --- Data fetchers -------------------------------------------------------

  async getProfile(tokens: LmsTokens): Promise<LmsProfile> {
    const profile = await this.request<CanvasProfile>(tokens, '/api/v1/users/self/profile');
    return {
      remoteUserId: String(profile.id),
      name: profile.name ?? profile.short_name ?? 'Canvas user',
      email: profile.primary_email ?? undefined,
      studentId: profile.sis_user_id ?? undefined,
      avatarUrl: profile.avatar_url ?? undefined,
      raw: profile as unknown as Record<string, unknown>,
    };
  }

  async getCourses(tokens: LmsTokens, _opts?: FetchOptions): Promise<ExternalCourse[]> {
    const courses = await this.paginated<CanvasCourse>(tokens, '/api/v1/courses', {
      enrollment_state: 'active',
      per_page: '100',
      include: ['term', 'teachers'],
    });
    return courses.map((c) => ({
      externalId: String(c.id),
      name: c.name,
      code: c.course_code,
      instructor: c.teachers?.[0]?.display_name,
      term: c.term?.name,
      active: c.workflow_state !== 'completed' && c.workflow_state !== 'deleted',
      remoteUpdatedAt: c.updated_at ? new Date(c.updated_at) : undefined,
    }));
  }

  async getAssignments(
    tokens: LmsTokens,
    courseExternalId: string,
    opts?: FetchOptions,
  ): Promise<ExternalAssignment[]> {
    const items = await this.paginated<CanvasAssignment>(
      tokens,
      `/api/v1/courses/${courseExternalId}/assignments`,
      { per_page: '100', include: ['submission'] },
    );
    const since = opts?.since;
    return items
      .filter((a) => !since || (a.updated_at ? new Date(a.updated_at) >= since : true))
      .map((a) => {
        const submissionTypes = a.submission_types ?? [];
        const isQuiz = submissionTypes.includes('online_quiz');
        return {
          externalId: String(a.id),
          courseExternalId,
          title: a.name,
          description: a.description ?? undefined,
          dueAt: a.due_at ? new Date(a.due_at) : undefined,
          maxPoints: a.points_possible ?? undefined,
          type: isQuiz ? 'quiz' : submissionTypes[0],
          url: a.html_url,
          submitted: Boolean(a.has_submitted_submissions),
          remoteUpdatedAt: a.updated_at ? new Date(a.updated_at) : undefined,
        };
      });
  }

  async getExams(
    tokens: LmsTokens,
    courseExternalId: string,
    opts?: FetchOptions,
  ): Promise<ExternalExam[]> {
    // Canvas exposes exams via calendar events (type=event) with title patterns
    // like "Midterm" / "Final". We also pull assignments where submission_types
    // includes online_quiz — those show up in getAssignments already, so this
    // method focuses on calendar-scheduled exam sittings.
    const events = await this.calendarEvents(tokens, courseExternalId);
    return events
      .filter((e) => /exam|midterm|final|test/i.test(e.title))
      .filter((e) => !opts?.since || (e.start_at ? new Date(e.start_at) >= opts.since : true))
      .map((e) => ({
        externalId: `event-${e.id}`,
        courseExternalId,
        title: e.title,
        description: e.description ?? undefined,
        scheduledAt: e.start_at ? new Date(e.start_at) : undefined,
        durationMinutes:
          e.start_at && e.end_at
            ? Math.round((new Date(e.end_at).getTime() - new Date(e.start_at).getTime()) / 60_000)
            : undefined,
        location: e.location_name ?? undefined,
        url: e.html_url,
      }));
  }

  async getAnnouncements(
    tokens: LmsTokens,
    courseExternalId: string,
    opts?: FetchOptions,
  ): Promise<ExternalAnnouncement[]> {
    // Announcements are discussion topics with only_announcements=true.
    const items = await this.paginated<CanvasDiscussionTopic>(
      tokens,
      `/api/v1/courses/${courseExternalId}/discussion_topics`,
      { per_page: '50', only_announcements: 'true' },
    );
    const since = opts?.since;
    return items
      .filter((t) => !since || (t.posted_at ? new Date(t.posted_at) >= since : true))
      .map((t) => ({
        externalId: String(t.id),
        courseExternalId,
        title: t.title,
        body: t.message ?? undefined,
        author: t.author?.display_name ?? undefined,
        postedAt: t.posted_at ? new Date(t.posted_at) : undefined,
        url: t.html_url,
        remoteUpdatedAt: t.updated_at ? new Date(t.updated_at) : undefined,
      }));
  }

  async getGrades(
    tokens: LmsTokens,
    courseExternalId: string,
    _opts?: FetchOptions,
  ): Promise<ExternalGrade[]> {
    const enrollments = await this.paginated<CanvasEnrollment>(
      tokens,
      `/api/v1/courses/${courseExternalId}/enrollments`,
      { per_page: '50', 'user_id[]': 'self' as unknown as string },
    );
    return enrollments
      .filter((e) => e.grades)
      .map((e) => {
        const currentScore = e.grades?.current_score;
        const finalScore = e.grades?.final_score;
        return {
          externalId: `enrollment-${e.id}`,
          courseExternalId,
          label: `Course grade`,
          score: finalScore ?? currentScore ?? undefined,
          maxScore: 100,
          percentage: finalScore ?? currentScore ?? undefined,
          letterGrade: e.grades?.final_grade ?? e.grades?.current_grade ?? undefined,
        };
      });
  }

  async getFiles(
    tokens: LmsTokens,
    courseExternalId: string,
    opts?: FetchOptions,
  ): Promise<ExternalFile[]> {
    const items = await this.paginated<CanvasFile>(
      tokens,
      `/api/v1/courses/${courseExternalId}/files`,
      { per_page: '100' },
    );
    const since = opts?.since;
    return items
      .filter((f) => !since || (f.updated_at ? new Date(f.updated_at) >= since : true))
      .map((f) => ({
        externalId: String(f.id),
        courseExternalId,
        filename: f.display_name ?? f.filename ?? `file-${f.id}`,
        mimeType: f['content-type'],
        sizeBytes: f.size,
        url: f.url,
        remoteUpdatedAt: f.updated_at ? new Date(f.updated_at) : undefined,
      }));
  }

  async getCalendar(
    tokens: LmsTokens,
    courseExternalId: string,
    _opts?: FetchOptions,
  ): Promise<ExternalCalendarEvent[]> {
    const events = await this.calendarEvents(tokens, courseExternalId);
    return events
      .filter((e) => e.start_at)
      .map((e) => {
        const title = e.title.toLowerCase();
        let type: ExternalCalendarEvent['type'] = 'other';
        if (/lecture|class/.test(title)) type = 'lecture';
        else if (/lab|practical/.test(title)) type = 'lab';
        else if (/exam|midterm|final|test/.test(title)) type = 'exam';
        else if (/office\s+hours/.test(title)) type = 'office_hours';
        else if (/due|deadline/.test(title)) type = 'deadline';
        return {
          externalId: `event-${e.id}`,
          courseExternalId,
          title: e.title,
          description: e.description ?? undefined,
          startAt: new Date(e.start_at!),
          endAt: e.end_at ? new Date(e.end_at) : undefined,
          location: e.location_name ?? undefined,
          type,
          url: e.html_url,
        };
      });
  }

  // --- Internals -----------------------------------------------------------

  private async calendarEvents(
    tokens: LmsTokens,
    courseExternalId: string,
  ): Promise<CanvasCalendarEvent[]> {
    // Canvas requires context_codes for cross-course queries; scope to one course.
    return this.paginated<CanvasCalendarEvent>(tokens, '/api/v1/calendar_events', {
      per_page: '50',
      'context_codes[]': `course_${courseExternalId}` as unknown as string,
      all_events: 'true',
      type: 'event',
    });
  }

  private async paginated<T>(
    tokens: LmsTokens,
    path: string,
    query: Record<string, string | string[]>,
  ): Promise<T[]> {
    const url = new URL(this.cfg.portalUrl + path);
    for (const [k, v] of Object.entries(query)) {
      if (Array.isArray(v)) v.forEach((item) => url.searchParams.append(k, item));
      else url.searchParams.set(k, v);
    }

    const results: T[] = [];
    let next: string | null = url.toString();
    let safety = 0;
    while (next && safety < 200) {
      safety++;
      const res = await this.fetchWithBackoff(next, {
        headers: { Authorization: `Bearer ${tokens.accessToken}`, Accept: 'application/json' },
      });
      const page = (await res.json()) as T[];
      results.push(...page);
      next = parseNextLink(res.headers.get('link'));
    }
    return results;
  }

  private async request<T>(tokens: LmsTokens, path: string): Promise<T> {
    const res = await this.fetchWithBackoff(this.cfg.portalUrl + path, {
      headers: { Authorization: `Bearer ${tokens.accessToken}`, Accept: 'application/json' },
    });
    return (await res.json()) as T;
  }

  /**
   * Wraps fetch with exponential backoff on 429/5xx. Three in-adapter retries;
   * beyond that surfaces a retryable LmsProviderError so BullMQ can requeue
   * the whole job with its own outer retry policy. Each attempt (including
   * retries) is recorded on the shared SyncMetrics collector so the sync log
   * reports the true wall time spent on this provider.
   */
  private async fetchWithBackoff(
    url: string,
    init: RequestInit,
    attempt = 0,
  ): Promise<Response> {
    const start = Date.now();
    const res = await fetch(url, init);
    if (this.metrics) this.metrics.recordRequest(Date.now() - start);
    if (res.status === 429 || res.status >= 500) {
      if (attempt < 3) {
        const wait = Math.min(2 ** attempt * 500, 4000);
        await new Promise((r) => setTimeout(r, wait));
        return this.fetchWithBackoff(url, init, attempt + 1);
      }
      throw new LmsProviderError(
        this.provider,
        `HTTP ${res.status} after ${attempt} retries at ${url}`,
        res.status,
        true,
      );
    }
    if (res.status === 401 || res.status === 403) {
      throw new LmsProviderError(
        this.provider,
        `HTTP ${res.status} at ${url} — token expired or scope missing`,
        res.status,
      );
    }
    if (!res.ok) {
      throw new LmsProviderError(this.provider, `HTTP ${res.status} at ${url}`, res.status);
    }
    return res;
  }
}

/** Extracts the `rel="next"` URL from a Link header, or null. */
function parseNextLink(header: string | null): string | null {
  if (!header) return null;
  for (const part of header.split(',')) {
    const match = part.match(/<([^>]+)>;\s*rel="next"/);
    if (match) return match[1] ?? null;
  }
  return null;
}
