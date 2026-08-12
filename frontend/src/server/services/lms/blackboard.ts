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
 * Blackboard Learn adapter — real implementation against the Blackboard Learn
 * REST API v1/v2/v3. Auth is 3-legged OAuth2 (authorization_code grant).
 *
 *   https://developer.blackboard.com/portal/displayApi
 *
 * Blackboard is hosted per-institution: the `portalUrl` on LmsConnection is
 * that school's Learn URL (e.g. https://blackboard.university.edu). All API
 * calls are relative to it, so the same adapter code serves every school with
 * a Learn instance.
 *
 * Pagination: list endpoints return `results` + `paging.nextPage`. We follow
 * the nextPage URL until it's absent.
 *
 * Errors: Blackboard returns `{ status, code, message, developerMessage }` on
 * failures. 401 means the token expired (refresh path handles rotation); 429
 * and 5xx are retried with exponential backoff.
 */

// --- Response shapes (partial — we only read what we need) -------------------

interface BbUser {
  id: string;
  userName?: string;
  studentId?: string;
  name?: {
    given?: string;
    family?: string;
    other?: string;
    preferredDisplayName?: 'GivenName' | 'FamilyName';
  };
  contact?: { email?: string };
  educationLevel?: string;
  avatar?: { source?: string; viewUrl?: string };
}

interface BbCourse {
  id: string;
  courseId?: string;
  name: string;
  description?: string;
  created?: string;
  modified?: string;
  availability?: { available?: 'Yes' | 'No' | 'Disabled' | 'Term' };
  termId?: string;
}

interface BbMembership {
  id: string;
  userId: string;
  courseId: string;
  courseRoleId?: string;
  created?: string;
  modified?: string;
  availability?: { available?: string };
}

interface BbGradebookColumn {
  id: string;
  name: string;
  description?: string;
  externalId?: string;
  score?: { possible?: number };
  availability?: { available?: string };
  grading?: { due?: string; type?: string };
  contentId?: string;
  created?: string;
  modified?: string;
}

interface BbGradebookAttempt {
  id: string;
  userId: string;
  score?: number;
  status?: string;
  attemptDate?: string;
  created?: string;
  modified?: string;
  columnId?: string;
  displayGrade?: { text?: string; scaleType?: string; score?: number; possible?: number };
}

interface BbAnnouncement {
  id: string;
  title: string;
  body?: string;
  creator?: string;
  created?: string;
  modified?: string;
  availability?: { duration?: { type?: string; start?: string; end?: string } };
}

interface BbContent {
  id: string;
  parentId?: string;
  title: string;
  body?: string;
  created?: string;
  modified?: string;
  contentHandler?: { id?: string; url?: string };
  hasChildren?: boolean;
}

interface BbCalendarItem {
  id: string;
  calendarId?: string;
  title: string;
  description?: string;
  location?: { name?: string };
  start?: string;
  end?: string;
  type?: 'Course' | 'GradebookColumn' | 'OfficeHours' | 'Institution' | 'Personal';
  recurrenceRule?: unknown;
}

interface BbTokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  user_id?: string;
}

interface BbListEnvelope<T> {
  results: T[];
  paging?: { nextPage?: string };
}

interface BbErrorEnvelope {
  status?: number;
  code?: string;
  message?: string;
  developerMessage?: string;
}

/**
 * Read scopes required to see the student's own courses, grades, calendar,
 * announcements, and content. `offline` is required to get a refresh_token.
 */
const SCOPES = 'read offline';

export class BlackboardAdapter implements LmsAdapter {
  readonly provider = LmsProvider.BLACKBOARD;
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
    });
    return `${this.cfg.portalUrl}/learn/api/public/v1/oauth2/authorizationcode?${params.toString()}`;
  }

  async authenticate(code: string): Promise<LmsTokens> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.cfg.redirectUri,
    });
    return this.tokenExchange(body);
  }

  async refresh(refreshToken: string): Promise<LmsRefreshResult> {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });
    const tokens = await this.tokenExchange(body);
    const rotated = Boolean(tokens.refreshToken && tokens.refreshToken !== refreshToken);
    return {
      tokens: {
        ...tokens,
        refreshToken: tokens.refreshToken ?? refreshToken,
      },
      rotated,
    };
  }

  async revoke(_tokens: LmsTokens): Promise<void> {
    // Blackboard doesn't expose a token-revocation endpoint on the public REST
    // surface — tokens just expire naturally. Nothing to do here.
    return;
  }

  private async tokenExchange(body: URLSearchParams): Promise<LmsTokens> {
    // Blackboard uses HTTP Basic auth with client_id:client_secret on the token
    // endpoint (spec-standard) — do NOT put them in the form body.
    const basic = Buffer.from(`${this.cfg.clientId}:${this.cfg.clientSecret}`).toString('base64');
    const url = `${this.cfg.portalUrl}/learn/api/public/v1/oauth2/token`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        Authorization: `Basic ${basic}`,
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
    const json = (await res.json()) as BbTokenResponse;
    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      expiresAt: json.expires_in ? new Date(Date.now() + json.expires_in * 1000) : undefined,
    };
  }

  // --- Data fetchers -------------------------------------------------------

  async getProfile(tokens: LmsTokens): Promise<LmsProfile> {
    const me = await this.request<BbUser>(tokens, '/learn/api/public/v1/users/me');
    const given = me.name?.given ?? '';
    const family = me.name?.family ?? '';
    const full = [given, family].filter(Boolean).join(' ') || me.userName || 'Blackboard user';
    return {
      remoteUserId: me.id,
      name: full,
      email: me.contact?.email,
      studentId: me.studentId,
      program: me.educationLevel,
      avatarUrl: me.avatar?.viewUrl,
      raw: me as unknown as Record<string, unknown>,
    };
  }

  async getCourses(tokens: LmsTokens, _opts?: FetchOptions): Promise<ExternalCourse[]> {
    // Two-step: memberships gives us course ids for the current user, then a
    // batch of course lookups gives us the full metadata. Blackboard has no
    // single "my courses" endpoint that returns full course objects.
    const memberships = await this.paginated<BbMembership>(
      tokens,
      '/learn/api/public/v1/users/me/courses',
      { fields: 'id,courseId,userId,availability,created,modified' },
    );
    const active = memberships.filter(
      (m) => m.availability?.available === 'Yes' || m.availability?.available === undefined,
    );
    const courses: ExternalCourse[] = [];
    // Fetch each course's metadata in parallel with a small concurrency cap so
    // we don't hammer the institution's Learn instance.
    const chunks = chunk(active, 5);
    for (const group of chunks) {
      const results = await Promise.allSettled(
        group.map((m) => this.request<BbCourse>(tokens, `/learn/api/public/v1/courses/${m.courseId ?? m.id}`)),
      );
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        if (!r) continue;
        if (r.status === 'fulfilled') {
          const c = r.value;
          courses.push({
            externalId: c.id,
            name: c.name,
            code: c.courseId,
            active: c.availability?.available !== 'No',
            term: c.termId,
            remoteUpdatedAt: c.modified ? new Date(c.modified) : undefined,
          });
        } else {
          logger.warn({ err: r.reason }, 'blackboard: course lookup failed');
        }
      }
    }
    return courses;
  }

  async getAssignments(
    tokens: LmsTokens,
    courseExternalId: string,
    opts?: FetchOptions,
  ): Promise<ExternalAssignment[]> {
    // In Blackboard the "assignment" concept is a gradebook column with a
    // due date. Columns without a due date are still gradable but treated as
    // ongoing coursework here.
    const columns = await this.paginated<BbGradebookColumn>(
      tokens,
      `/learn/api/public/v2/courses/${courseExternalId}/gradebook/columns`,
    );
    // Fetch user's own attempts once (used to flag `submitted`).
    const attempts = await this.paginated<BbGradebookAttempt>(
      tokens,
      `/learn/api/public/v2/courses/${courseExternalId}/gradebook/users/me/attempts`,
    ).catch(() => [] as BbGradebookAttempt[]);
    const submittedColumns = new Set(
      attempts.filter((a) => a.status === 'Completed' || a.status === 'InProgress').map((a) => a.columnId).filter(Boolean),
    );
    const since = opts?.since;
    return columns
      .filter((c) => !since || (c.modified ? new Date(c.modified) >= since : true))
      .map((c) => ({
        externalId: c.id,
        courseExternalId,
        title: c.name,
        description: c.description,
        dueAt: c.grading?.due ? new Date(c.grading.due) : undefined,
        maxPoints: c.score?.possible,
        type: c.grading?.type?.toLowerCase() ?? 'assignment',
        submitted: submittedColumns.has(c.id),
        remoteUpdatedAt: c.modified ? new Date(c.modified) : undefined,
      }));
  }

  async getExams(
    _tokens: LmsTokens,
    _courseExternalId: string,
    _opts?: FetchOptions,
  ): Promise<ExternalExam[]> {
    // Blackboard "Tests" live under the same gradebook columns machinery as
    // assignments — they're already surfaced through getAssignments. Returning
    // an empty list here avoids double-counting.
    return [];
  }

  async getAnnouncements(
    tokens: LmsTokens,
    courseExternalId: string,
    opts?: FetchOptions,
  ): Promise<ExternalAnnouncement[]> {
    const items = await this.paginated<BbAnnouncement>(
      tokens,
      `/learn/api/public/v1/courses/${courseExternalId}/announcements`,
    );
    const since = opts?.since;
    return items
      .filter((a) => !since || (a.modified ? new Date(a.modified) >= since : true))
      .map((a) => ({
        externalId: a.id,
        courseExternalId,
        title: a.title,
        body: a.body,
        author: a.creator,
        postedAt: a.created ? new Date(a.created) : undefined,
        remoteUpdatedAt: a.modified ? new Date(a.modified) : undefined,
      }));
  }

  async getGrades(
    tokens: LmsTokens,
    courseExternalId: string,
    _opts?: FetchOptions,
  ): Promise<ExternalGrade[]> {
    // Grades come from the user's attempts, joined against column metadata for
    // the assignment name + max points.
    const [attempts, columns] = await Promise.all([
      this.paginated<BbGradebookAttempt>(
        tokens,
        `/learn/api/public/v2/courses/${courseExternalId}/gradebook/users/me/attempts`,
      ),
      this.paginated<BbGradebookColumn>(
        tokens,
        `/learn/api/public/v2/courses/${courseExternalId}/gradebook/columns`,
      ),
    ]);
    const colById = new Map(columns.map((c) => [c.id, c]));
    const graded = attempts.filter((a) => typeof a.score === 'number');
    return graded.map((a) => {
      const col = a.columnId ? colById.get(a.columnId) : undefined;
      const max = col?.score?.possible ?? a.displayGrade?.possible;
      const score = a.score ?? a.displayGrade?.score;
      return {
        externalId: a.id,
        courseExternalId,
        assignmentExternalId: a.columnId,
        label: col?.name ?? 'Gradebook item',
        score,
        maxScore: max,
        percentage: max && score != null ? (score / max) * 100 : undefined,
        letterGrade: a.displayGrade?.text,
        postedAt: a.modified ? new Date(a.modified) : undefined,
      };
    });
  }

  async getFiles(
    tokens: LmsTokens,
    courseExternalId: string,
    opts?: FetchOptions,
  ): Promise<ExternalFile[]> {
    // Blackboard content is a tree; we recurse one level deep (top-level items
    // then their direct children) which covers the common "Course Content →
    // Week 1 → materials" layout without an unbounded crawl.
    const roots = await this.paginated<BbContent>(
      tokens,
      `/learn/api/public/v1/courses/${courseExternalId}/contents`,
    );
    const since = opts?.since;
    const files: ExternalFile[] = [];
    for (const root of roots) {
      addContentAsFile(files, courseExternalId, root, since);
      if (!root.hasChildren) continue;
      try {
        const children = await this.paginated<BbContent>(
          tokens,
          `/learn/api/public/v1/courses/${courseExternalId}/contents/${root.id}/children`,
        );
        for (const child of children) addContentAsFile(files, courseExternalId, child, since);
      } catch (err) {
        logger.warn({ err, parentId: root.id }, 'blackboard: children fetch failed');
      }
    }
    return files;
  }

  async getCalendar(
    tokens: LmsTokens,
    courseExternalId: string,
    opts?: FetchOptions,
  ): Promise<ExternalCalendarEvent[]> {
    // Blackboard's calendar API takes a date range; we always fetch a
    // 6-months-forward window from now (or from `since` if it's earlier).
    const start = opts?.since ?? new Date();
    const end = new Date(start.getTime() + 180 * 24 * 60 * 60 * 1000);
    const params = new URLSearchParams({
      'since': start.toISOString(),
      'until': end.toISOString(),
      'courseId': courseExternalId,
    });
    try {
      const items = await this.paginated<BbCalendarItem>(
        tokens,
        `/learn/api/public/v1/calendars/items?${params.toString()}`,
      );
      return items
        .filter((i) => i.start)
        .map((i) => ({
          externalId: i.id,
          courseExternalId,
          title: i.title,
          description: i.description,
          startAt: new Date(i.start!),
          endAt: i.end ? new Date(i.end) : undefined,
          location: i.location?.name,
          type: mapCalendarType(i.type),
        }));
    } catch (err) {
      logger.warn({ err }, 'blackboard: calendar fetch failed');
      return [];
    }
  }

  // --- Internals -----------------------------------------------------------

  private async paginated<T>(
    tokens: LmsTokens,
    path: string,
    query: Record<string, string> = {},
  ): Promise<T[]> {
    let url = this.cfg.portalUrl + path;
    if (Object.keys(query).length > 0) {
      const sep = url.includes('?') ? '&' : '?';
      url = `${url}${sep}${new URLSearchParams(query).toString()}`;
    }

    const results: T[] = [];
    let safety = 0;
    // Blackboard returns full URLs in paging.nextPage, so we follow them
    // verbatim. Cap iterations at 200 as a runaway guard.
    while (safety++ < 200) {
      const res = await this.fetchWithBackoff(url, {
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
          Accept: 'application/json',
        },
      });
      const payload = (await res.json()) as BbListEnvelope<T>;
      if (Array.isArray(payload.results)) results.push(...payload.results);
      const next = payload.paging?.nextPage;
      if (!next) break;
      // nextPage is typically a path like "/learn/api/public/v1/..." — make it
      // absolute against portalUrl. If it's already absolute, use it as-is.
      url = next.startsWith('http') ? next : this.cfg.portalUrl + next;
    }
    return results;
  }

  private async request<T>(tokens: LmsTokens, path: string): Promise<T> {
    const res = await this.fetchWithBackoff(this.cfg.portalUrl + path, {
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        Accept: 'application/json',
      },
    });
    return (await res.json()) as T;
  }

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
      let message = `HTTP ${res.status}`;
      try {
        const body = (await res.clone().json()) as BbErrorEnvelope;
        if (body.message) message = `${message}: ${body.message}`;
      } catch {
        /* body not JSON */
      }
      throw new LmsProviderError(this.provider, `${message} at ${url}`, res.status);
    }
    return res;
  }
}

function addContentAsFile(
  files: ExternalFile[],
  courseExternalId: string,
  c: BbContent,
  since: Date | undefined,
): void {
  const parsed = c.modified ? new Date(c.modified) : undefined;
  if (since && parsed && parsed < since) return;
  // We only capture leaf items with a URL — folder-like nodes without a URL
  // aren't downloadable files.
  const url = c.contentHandler?.url;
  if (!url) return;
  files.push({
    externalId: c.id,
    courseExternalId,
    filename: c.title,
    url,
    remoteUpdatedAt: parsed,
  });
}

function mapCalendarType(t: BbCalendarItem['type']): ExternalCalendarEvent['type'] {
  switch (t) {
    case 'OfficeHours':
      return 'office_hours';
    case 'GradebookColumn':
      return 'deadline';
    case 'Course':
      return 'lecture';
    default:
      return 'other';
  }
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
