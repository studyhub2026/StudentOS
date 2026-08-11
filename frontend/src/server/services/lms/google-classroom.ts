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
 * Google Classroom adapter — real implementation against the Google Classroom
 * REST API v1. Auth is OAuth2 with Google's endpoints; the app's existing
 * GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET (used for sign-in) is reused here.
 *
 *   https://developers.google.com/classroom/reference/rest
 *
 * The `portalUrl` field on LmsConnection is nominal for Google Classroom
 * (everything lives at classroom.googleapis.com), so the UI accepts either
 * `https://classroom.google.com` or the API base — we always talk to the
 * fixed API host regardless.
 *
 * Pagination: every list endpoint returns `nextPageToken`; we follow it until
 * the token is empty. `pageSize: 100` is the API max for most list calls.
 *
 * Errors: Google returns a `{ error: { code, message, status } }` envelope on
 * 4xx/5xx. We map 429/5xx to a retryable LmsProviderError and everything else
 * to non-retryable ones. Token expiry surfaces as 401 and the sync engine's
 * refresh path handles rotation via `refresh()`.
 */

const API_BASE = 'https://classroom.googleapis.com/v1';
const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';

/**
 * Read-only scope set. `classroom.rosters.readonly` is required for the
 * teacher-name lookup on courses; `courseworkmaterials.readonly` covers the
 * "materials" view where uploaded files live. Everything else is `.me` (the
 * student's own submissions/grades) so we never see other students' data.
 */
const SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/classroom.courses.readonly',
  'https://www.googleapis.com/auth/classroom.coursework.me.readonly',
  'https://www.googleapis.com/auth/classroom.coursework.me',
  'https://www.googleapis.com/auth/classroom.courseworkmaterials.readonly',
  'https://www.googleapis.com/auth/classroom.announcements.readonly',
  'https://www.googleapis.com/auth/classroom.student-submissions.me.readonly',
  'https://www.googleapis.com/auth/classroom.rosters.readonly',
  'https://www.googleapis.com/auth/classroom.topics.readonly',
].join(' ');

// --- API response shapes we actually read (partial by design) ----------------

interface GcCourse {
  id: string;
  name: string;
  section?: string;
  descriptionHeading?: string;
  room?: string;
  ownerId?: string;
  courseState?: 'ACTIVE' | 'ARCHIVED' | 'PROVISIONED' | 'DECLINED' | 'SUSPENDED';
  enrollmentCode?: string;
  updateTime?: string;
  alternateLink?: string;
}

interface GcTeacher {
  userId: string;
  profile?: {
    name?: { fullName?: string };
    emailAddress?: string;
  };
}

interface GcCourseWork {
  courseId: string;
  id: string;
  title: string;
  description?: string;
  materials?: GcMaterial[];
  state?: 'PUBLISHED' | 'DRAFT' | 'DELETED';
  alternateLink?: string;
  creationTime?: string;
  updateTime?: string;
  dueDate?: { year: number; month: number; day: number };
  dueTime?: { hours?: number; minutes?: number };
  maxPoints?: number;
  workType?:
    | 'ASSIGNMENT'
    | 'SHORT_ANSWER_QUESTION'
    | 'MULTIPLE_CHOICE_QUESTION'
    | 'COURSE_WORK_TYPE_UNSPECIFIED';
  submissionModificationMode?: string;
}

interface GcAnnouncement {
  courseId: string;
  id: string;
  text?: string;
  materials?: GcMaterial[];
  state?: 'PUBLISHED' | 'DRAFT' | 'DELETED';
  alternateLink?: string;
  creationTime?: string;
  updateTime?: string;
  creatorUserId?: string;
}

interface GcMaterial {
  driveFile?: {
    driveFile?: {
      id: string;
      title: string;
      alternateLink?: string;
      thumbnailUrl?: string;
    };
    shareMode?: string;
  };
  youtubeVideo?: { id: string; title?: string; alternateLink?: string };
  link?: { url: string; title?: string; thumbnailUrl?: string };
  form?: { formUrl: string; title?: string; thumbnailUrl?: string };
}

interface GcCourseWorkMaterial {
  courseId: string;
  id: string;
  title: string;
  description?: string;
  materials?: GcMaterial[];
  state?: string;
  alternateLink?: string;
  creationTime?: string;
  updateTime?: string;
}

interface GcStudentSubmission {
  courseId: string;
  courseWorkId: string;
  id: string;
  userId?: string;
  state?: 'NEW' | 'CREATED' | 'TURNED_IN' | 'RETURNED' | 'RECLAIMED_BY_STUDENT';
  assignedGrade?: number;
  draftGrade?: number;
  updateTime?: string;
  alternateLink?: string;
}

interface GcUserProfile {
  id: string;
  name?: { fullName?: string; givenName?: string; familyName?: string };
  emailAddress?: string;
  photoUrl?: string;
}

interface GcOAuthTokenResponse {
  access_token: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  id_token?: string;
}

interface GcError {
  error: { code: number; message: string; status?: string };
}

// --- Adapter -----------------------------------------------------------------

export class GoogleClassroomAdapter implements LmsAdapter {
  readonly provider = LmsProvider.GOOGLE_CLASSROOM;
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
      scope: SCOPES,
      // `offline` returns a refresh_token; `prompt=consent` forces the consent
      // screen to appear even on repeat authorizations, which is the only
      // reliable way to get a fresh refresh_token after scope changes.
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
    });
    return `${AUTHORIZE_URL}?${params.toString()}`;
  }

  async authenticate(code: string): Promise<LmsTokens> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: this.cfg.clientId,
      client_secret: this.cfg.clientSecret,
      redirect_uri: this.cfg.redirectUri,
      code,
    });
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body,
    });
    if (!res.ok) {
      throw new LmsProviderError(
        this.provider,
        `token exchange failed (${res.status}): ${(await res.text()).slice(0, 300)}`,
        res.status,
      );
    }
    const json = (await res.json()) as GcOAuthTokenResponse;
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
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body,
    });
    if (!res.ok) {
      throw new LmsProviderError(
        this.provider,
        `refresh failed (${res.status}): ${(await res.text()).slice(0, 300)}`,
        res.status,
      );
    }
    const json = (await res.json()) as GcOAuthTokenResponse;
    // Google typically does NOT rotate refresh tokens — the same one keeps
    // working until the user revokes access. If a new one comes back we
    // honour it; otherwise we return the incoming refresh token unchanged so
    // the sync engine's persist step doesn't null out our copy.
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
    // Google's revoke endpoint accepts either the access or the refresh token
    // and invalidates the whole grant. Best-effort — a failure just means the
    // grant expires on Google's normal timeline.
    const target = tokens.refreshToken ?? tokens.accessToken;
    try {
      await fetch(`${REVOKE_URL}?token=${encodeURIComponent(target)}`, { method: 'POST' });
    } catch (err) {
      logger.warn({ err }, 'google-classroom: revoke failed (non-fatal)');
    }
  }

  // --- Data fetchers -------------------------------------------------------

  async getProfile(tokens: LmsTokens): Promise<LmsProfile> {
    // We prefer the OpenID userinfo endpoint over Classroom's userProfiles/me
    // because it's the same shape as the login flow (name + email + picture)
    // and doesn't require the roster scope.
    const info = await this.request<{
      sub: string;
      name?: string;
      email?: string;
      picture?: string;
    }>(tokens, USERINFO_URL, { absolute: true });
    return {
      remoteUserId: info.sub,
      name: info.name ?? info.email ?? 'Google user',
      email: info.email,
      avatarUrl: info.picture,
      raw: info as unknown as Record<string, unknown>,
    };
  }

  async getCourses(tokens: LmsTokens, _opts?: FetchOptions): Promise<ExternalCourse[]> {
    const courses = await this.paginated<GcCourse>(tokens, '/courses', {
      courseStates: 'ACTIVE',
      pageSize: '100',
    });
    // Look up the primary teacher for each course in parallel (best-effort).
    const withTeacher = await Promise.all(
      courses.map(async (c) => {
        let instructor: string | undefined;
        try {
          const teachers = await this.paginated<GcTeacher>(
            tokens,
            `/courses/${c.id}/teachers`,
            { pageSize: '5' },
          );
          instructor = teachers[0]?.profile?.name?.fullName;
        } catch {
          // Roster access may be denied; leave instructor blank.
        }
        return { c, instructor };
      }),
    );
    return withTeacher.map(({ c, instructor }) => ({
      externalId: c.id,
      name: c.name,
      code: c.section ?? undefined,
      term: undefined,
      instructor,
      active: c.courseState === 'ACTIVE' || c.courseState === undefined,
      remoteUpdatedAt: c.updateTime ? new Date(c.updateTime) : undefined,
    }));
  }

  async getAssignments(
    tokens: LmsTokens,
    courseExternalId: string,
    opts?: FetchOptions,
  ): Promise<ExternalAssignment[]> {
    const items = await this.paginated<GcCourseWork>(
      tokens,
      `/courses/${courseExternalId}/courseWork`,
      { pageSize: '100', courseWorkStates: 'PUBLISHED' },
    );
    // Fetch this user's submissions once so we can flag `submitted` accurately
    // without one round-trip per assignment.
    const submissions = await this.paginated<GcStudentSubmission>(
      tokens,
      `/courses/${courseExternalId}/courseWork/-/studentSubmissions`,
      { pageSize: '100', userId: 'me' },
    ).catch(() => [] as GcStudentSubmission[]);
    const submittedIds = new Set(
      submissions
        .filter((s) => s.state === 'TURNED_IN' || s.state === 'RETURNED')
        .map((s) => s.courseWorkId),
    );
    const since = opts?.since;
    return items
      .filter((a) => !since || (a.updateTime ? new Date(a.updateTime) >= since : true))
      .map((a) => ({
        externalId: a.id,
        courseExternalId,
        title: a.title,
        description: a.description,
        dueAt: gcDueToDate(a.dueDate, a.dueTime),
        maxPoints: a.maxPoints,
        type:
          a.workType === 'SHORT_ANSWER_QUESTION' ||
          a.workType === 'MULTIPLE_CHOICE_QUESTION'
            ? 'quiz'
            : 'assignment',
        url: a.alternateLink,
        submitted: submittedIds.has(a.id),
        remoteUpdatedAt: a.updateTime ? new Date(a.updateTime) : undefined,
      }));
  }

  /**
   * Classroom exposes quizzes as courseWork with `workType` of SHORT_ANSWER /
   * MULTIPLE_CHOICE. Those show up in getAssignments already; getExams here
   * returns nothing so we don't double-count. Kept as a no-op so the LmsAdapter
   * contract stays satisfied and future Classroom API changes have a hook.
   */
  async getExams(
    _tokens: LmsTokens,
    _courseExternalId: string,
    _opts?: FetchOptions,
  ): Promise<ExternalExam[]> {
    return [];
  }

  async getAnnouncements(
    tokens: LmsTokens,
    courseExternalId: string,
    opts?: FetchOptions,
  ): Promise<ExternalAnnouncement[]> {
    const items = await this.paginated<GcAnnouncement>(
      tokens,
      `/courses/${courseExternalId}/announcements`,
      { pageSize: '50', announcementStates: 'PUBLISHED' },
    );
    const since = opts?.since;
    return items
      .filter((a) => !since || (a.updateTime ? new Date(a.updateTime) >= since : true))
      .map((a) => {
        const text = a.text ?? '';
        const firstLine = text.split('\n')[0]?.trim() ?? 'Announcement';
        return {
          externalId: a.id,
          courseExternalId,
          title: firstLine.length > 80 ? `${firstLine.slice(0, 77)}…` : firstLine,
          body: text,
          author: undefined,
          postedAt: a.creationTime ? new Date(a.creationTime) : undefined,
          url: a.alternateLink,
          remoteUpdatedAt: a.updateTime ? new Date(a.updateTime) : undefined,
        };
      });
  }

  async getGrades(
    tokens: LmsTokens,
    courseExternalId: string,
    _opts?: FetchOptions,
  ): Promise<ExternalGrade[]> {
    // Grades come from studentSubmissions with a numeric `assignedGrade`. We
    // also need coursework metadata to expose the assignment name + max points
    // on each grade row.
    const [subs, work] = await Promise.all([
      this.paginated<GcStudentSubmission>(
        tokens,
        `/courses/${courseExternalId}/courseWork/-/studentSubmissions`,
        { pageSize: '100', userId: 'me' },
      ),
      this.paginated<GcCourseWork>(
        tokens,
        `/courses/${courseExternalId}/courseWork`,
        { pageSize: '100' },
      ),
    ]);
    const workById = new Map(work.map((w) => [w.id, w]));
    const graded = subs.filter((s) => typeof s.assignedGrade === 'number');
    return graded.map((s) => {
      const w = workById.get(s.courseWorkId);
      const max = w?.maxPoints;
      return {
        externalId: `sub-${s.id}`,
        courseExternalId,
        assignmentExternalId: s.courseWorkId,
        label: w?.title ?? 'Coursework',
        score: s.assignedGrade,
        maxScore: max,
        percentage: max ? (Number(s.assignedGrade) / max) * 100 : undefined,
        letterGrade: undefined,
        postedAt: s.updateTime ? new Date(s.updateTime) : undefined,
      };
    });
  }

  async getFiles(
    tokens: LmsTokens,
    courseExternalId: string,
    opts?: FetchOptions,
  ): Promise<ExternalFile[]> {
    // Classroom "files" live in two places: (1) courseWorkMaterials — the
    // teacher's shared references, and (2) materials attached to individual
    // coursework/announcements. We surface both, keyed by drive file id so
    // the same file referenced from two places doesn't duplicate.
    const [materials, work, announcements] = await Promise.all([
      this.paginated<GcCourseWorkMaterial>(
        tokens,
        `/courses/${courseExternalId}/courseWorkMaterials`,
        { pageSize: '100' },
      ).catch(() => [] as GcCourseWorkMaterial[]),
      this.paginated<GcCourseWork>(
        tokens,
        `/courses/${courseExternalId}/courseWork`,
        { pageSize: '100' },
      ).catch(() => [] as GcCourseWork[]),
      this.paginated<GcAnnouncement>(
        tokens,
        `/courses/${courseExternalId}/announcements`,
        { pageSize: '50' },
      ).catch(() => [] as GcAnnouncement[]),
    ]);

    const since = opts?.since;
    const seen = new Map<string, ExternalFile>();
    const collect = (
      updateTime: string | undefined,
      materialsList: GcMaterial[] | undefined,
    ) => {
      if (!materialsList) return;
      const parsedAt = updateTime ? new Date(updateTime) : undefined;
      if (since && parsedAt && parsedAt < since) return;
      for (const m of materialsList) {
        const df = m.driveFile?.driveFile;
        if (!df) continue;
        if (seen.has(df.id)) continue;
        seen.set(df.id, {
          externalId: `drive-${df.id}`,
          courseExternalId,
          filename: df.title,
          // The mime type isn't in the material payload; Drive files require a
          // separate Drive API call to introspect, which we skip to avoid
          // needing the Drive scope. The Knowledge Base ingester will fall
          // back to filename-based detection.
          mimeType: undefined,
          sizeBytes: undefined,
          url: df.alternateLink,
          remoteUpdatedAt: parsedAt,
        });
      }
    };

    for (const m of materials) collect(m.updateTime, m.materials);
    for (const w of work) collect(w.updateTime, w.materials);
    for (const a of announcements) collect(a.updateTime, a.materials);
    return [...seen.values()];
  }

  /**
   * Google Classroom has no first-class calendar API — coursework due dates
   * ARE the calendar. Return an empty list so the sync engine's calendar path
   * short-circuits; the assignment due dates already land as deadlines via
   * getAssignments → local Assignment.dueAt.
   */
  async getCalendar(
    _tokens: LmsTokens,
    _courseExternalId: string,
    _opts?: FetchOptions,
  ): Promise<ExternalCalendarEvent[]> {
    return [];
  }

  // --- Internals -----------------------------------------------------------

  /**
   * Follow `nextPageToken` until exhausted. `pageToken` is spelled with a
   * lowercase `t` on every Classroom endpoint despite the response using
   * `nextPageToken`; keep them straight.
   */
  private async paginated<T>(
    tokens: LmsTokens,
    path: string,
    query: Record<string, string | string[]>,
  ): Promise<T[]> {
    const url = new URL(API_BASE + path);
    for (const [k, v] of Object.entries(query)) {
      if (Array.isArray(v)) v.forEach((item) => url.searchParams.append(k, item));
      else url.searchParams.set(k, v);
    }

    const results: T[] = [];
    let pageToken: string | undefined;
    let safety = 0;
    do {
      safety++;
      if (safety > 200) break;
      if (pageToken) url.searchParams.set('pageToken', pageToken);
      const res = await this.fetchWithBackoff(url.toString(), {
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
          Accept: 'application/json',
        },
      });
      const payload = (await res.json()) as Record<string, unknown>;
      // Classroom list responses always wrap the array under a plural key that
      // matches the last path segment (courses, courseWork, announcements…).
      // We pick the first array-valued field so this helper works for all.
      const arrayValue = Object.values(payload).find((v): v is T[] => Array.isArray(v));
      if (arrayValue) results.push(...arrayValue);
      const next = payload['nextPageToken'];
      pageToken = typeof next === 'string' && next.length > 0 ? next : undefined;
    } while (pageToken);
    return results;
  }

  private async request<T>(
    tokens: LmsTokens,
    path: string,
    opts: { absolute?: boolean } = {},
  ): Promise<T> {
    const url = opts.absolute ? path : API_BASE + path;
    const res = await this.fetchWithBackoff(url, {
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        Accept: 'application/json',
      },
    });
    return (await res.json()) as T;
  }

  /**
   * fetch + retry loop. Google's rate-limit errors come back as 429 with an
   * exponentially-decreasing quota window; 5xx are transient service faults.
   * Anything else surfaces as a non-retryable LmsProviderError so BullMQ
   * doesn't waste attempts on permanent failures.
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
      // Try to parse Google's typed error for a nicer message.
      let message = `HTTP ${res.status}`;
      try {
        const body = (await res.clone().json()) as GcError;
        if (body.error?.message) message = `${message}: ${body.error.message}`;
      } catch {
        /* ignore */
      }
      throw new LmsProviderError(this.provider, `${message} at ${url}`, res.status);
    }
    return res;
  }
}

/**
 * Google Classroom's due dates come split across `dueDate` (year/month/day)
 * and `dueTime` (hours/minutes). Some assignments carry neither, some just
 * the date, some both. Convert to a UTC Date so the sync engine treats it
 * consistently — the local Assignment.dueAt column is a plain timestamp.
 */
export function gcDueToDate(
  dueDate?: { year: number; month: number; day: number },
  dueTime?: { hours?: number; minutes?: number },
): Date | undefined {
  if (!dueDate) return undefined;
  const y = dueDate.year;
  const m = dueDate.month - 1;
  const d = dueDate.day;
  const hh = dueTime?.hours ?? 23;
  const mm = dueTime?.minutes ?? 59;
  return new Date(Date.UTC(y, m, d, hh, mm, 0));
}
