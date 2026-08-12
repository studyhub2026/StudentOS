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
 * Brightspace (D2L) adapter — real implementation against the D2L Valence
 * REST API using OAuth 2.0 (Brightspace's modern auth model — NOT the
 * legacy Valence app-key/user-key signature scheme).
 *
 *   https://docs.valence.desire2learn.com/
 *
 * All D2L APIs are versioned: we pin to `unstable` for endpoints that don't
 * yet have a stable version (Brightspace's own docs recommend this), and to
 * concrete versions elsewhere. This mirrors what Brightspace SDKs do.
 *
 * Auth endpoints live on Brightspace's shared auth host (auth.brightspace.com),
 * NOT on the institution's own portal — data endpoints are on the portalUrl.
 */

const AUTH_HOST = 'https://auth.brightspace.com';
const AUTHORIZE_URL = `${AUTH_HOST}/oauth2/auth`;
const TOKEN_URL = `${AUTH_HOST}/core/connect/token`;

/** LP API version — the "Learning Platform" surface where courses/users live. */
const LP = '1.43';
/** LE API version — the "Learning Environment" surface where content/discussions live. */
const LE = '1.60';

const SCOPES = [
  'core:*:*',
  'users:userdata:read',
  'enrollment:orgunit:read',
  'organizations:organization:read',
  'content:topics:read',
  'content:modules:read',
  'grades:gradeobject:read',
  'grades:gradevalue:read',
  'dropbox:folder:read',
  'dropbox:submission:read',
  'news:feed:read',
  'calendar:calendar:read',
  'quizzing:quiz:read',
  'offline_access',
].join(' ');

interface D2lWhoAmI {
  Identifier: string;
  FirstName?: string;
  LastName?: string;
  UniqueName?: string;
  ProfileIdentifier?: string;
  PronounDisplayValue?: string;
}

interface D2lUser {
  UserId: string;
  UserName: string;
  DisplayName?: string;
  FirstName?: string;
  LastName?: string;
  ExternalEmail?: string;
  OrgDefinedId?: string;
}

interface D2lEnrollment {
  OrgUnit: { Id: number; Type: { Id: number; Code: string }; Name: string; Code?: string };
  Access?: { IsActive?: boolean };
}

interface D2lOrgUnit {
  Identifier: string;
  Name: string;
  Code?: string;
  Description?: { Text?: string; Html?: string };
}

interface D2lDropbox {
  Id: number;
  Name: string;
  Description?: { Text?: string; Html?: string };
  DueDate?: string;
  IsHidden?: boolean;
  MaxPoints?: number;
  Availability?: { StartDate?: string; EndDate?: string };
}

interface D2lGradeObject {
  Id: number;
  Name: string;
  ShortName?: string;
  GradeType?: string;
  MaxPoints?: number;
  IsBonus?: boolean;
  Description?: { Text?: string };
}

interface D2lGradeValue {
  DisplayedGrade?: string;
  GradeObjectIdentifier?: string;
  PointsNumerator?: number;
  PointsDenominator?: number;
  WeightedNumerator?: number;
  WeightedDenominator?: number;
  Comments?: { Text?: string };
  ReleasedDate?: string;
  LastModified?: string;
}

interface D2lNewsItem {
  Id: number;
  Title: string;
  Body?: { Text?: string; Html?: string };
  CreatedBy?: number;
  StartDate?: string;
  EndDate?: string;
  IsHidden?: boolean;
  LastModifiedDate?: string;
}

interface D2lTopic {
  Identifier: string;
  Title: string;
  ShortTitle?: string;
  Description?: { Text?: string };
  TopicType?: number;
  Url?: string;
  LastModifiedDate?: string;
}

interface D2lCalendarEvent {
  CalendarEventId: number;
  Title: string;
  Description?: { Text?: string; Html?: string };
  StartDateTime?: string;
  EndDateTime?: string;
  IsAllDay?: boolean;
  LocationName?: string;
  OrgUnitId?: number;
  EventType?: string;
}

interface D2lPagedResult<T> {
  Items?: T[];
  Objects?: T[];
  PagingInfo?: { Bookmark?: string; HasMoreItems?: boolean };
  Next?: string;
}

interface D2lTokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
}

export class BrightspaceAdapter implements LmsAdapter {
  readonly provider = LmsProvider.BRIGHTSPACE;
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
    return `${AUTHORIZE_URL}?${params.toString()}`;
  }

  async authenticate(code: string): Promise<LmsTokens> {
    return this.tokenExchange(
      new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: this.cfg.redirectUri,
      }),
    );
  }

  async refresh(refreshToken: string): Promise<LmsRefreshResult> {
    const tokens = await this.tokenExchange(
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    );
    const rotated = Boolean(tokens.refreshToken && tokens.refreshToken !== refreshToken);
    return {
      tokens: { ...tokens, refreshToken: tokens.refreshToken ?? refreshToken },
      rotated,
    };
  }

  async revoke(_tokens: LmsTokens): Promise<void> {
    // D2L doesn't publish a public revocation endpoint; tokens expire naturally.
    return;
  }

  private async tokenExchange(body: URLSearchParams): Promise<LmsTokens> {
    body.set('client_id', this.cfg.clientId);
    body.set('client_secret', this.cfg.clientSecret);
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
    const json = (await res.json()) as D2lTokenResponse;
    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      expiresAt: json.expires_in ? new Date(Date.now() + json.expires_in * 1000) : undefined,
    };
  }

  // --- Data fetchers -------------------------------------------------------

  async getProfile(tokens: LmsTokens): Promise<LmsProfile> {
    const who = await this.request<D2lWhoAmI>(tokens, `/d2l/api/lp/${LP}/users/whoami`);
    let user: D2lUser | null = null;
    try {
      user = await this.request<D2lUser>(tokens, `/d2l/api/lp/${LP}/users/${who.Identifier}`);
    } catch {
      /* user detail may require different scope */
    }
    const first = user?.FirstName ?? who.FirstName;
    const last = user?.LastName ?? who.LastName;
    const full = [first, last].filter(Boolean).join(' ') ||
      who.UniqueName ||
      user?.DisplayName ||
      'Brightspace user';
    return {
      remoteUserId: who.Identifier,
      name: full,
      email: user?.ExternalEmail,
      studentId: user?.OrgDefinedId ?? who.ProfileIdentifier,
      raw: { whoami: who, user } as unknown as Record<string, unknown>,
    };
  }

  async getCourses(tokens: LmsTokens, _opts?: FetchOptions): Promise<ExternalCourse[]> {
    // Enrollments are the definitive list of the user's own courses. Filter
    // to type "Course Offering" (Code === "Course Offering" or type id 3).
    const enrolments = await this.paged<D2lEnrollment>(
      tokens,
      `/d2l/api/lp/${LP}/enrollments/myenrollments/`,
    );
    const courses = enrolments.filter(
      (e) =>
        (e.OrgUnit.Type?.Code === 'Course Offering' || e.OrgUnit.Type?.Id === 3) &&
        (e.Access?.IsActive ?? true),
    );
    // Enrolment payloads already carry Name/Code; no need to look each course
    // up individually — that would be N extra requests for zero new data.
    return courses.map((c) => ({
      externalId: String(c.OrgUnit.Id),
      name: c.OrgUnit.Name,
      code: c.OrgUnit.Code ?? undefined,
      active: c.Access?.IsActive ?? true,
    }));
  }

  async getAssignments(
    tokens: LmsTokens,
    courseExternalId: string,
    opts?: FetchOptions,
  ): Promise<ExternalAssignment[]> {
    // Assignments live in Dropbox folders. Each folder is one assignment.
    const folders = await this.paged<D2lDropbox>(
      tokens,
      `/d2l/api/le/${LE}/${courseExternalId}/dropbox/folders/`,
    );
    const since = opts?.since;
    // Fetch each folder's submission status for the user — used to flag
    // `submitted`. Ignore submission errors (folder may be hidden mid-sync).
    const withSubmitted = await Promise.all(
      folders.map(async (f) => {
        let submitted = false;
        try {
          const submissions = await this.request<{ Submissions?: unknown[] }>(
            tokens,
            `/d2l/api/le/${LE}/${courseExternalId}/dropbox/folders/${f.Id}/submissions/`,
          );
          submitted = Array.isArray(submissions.Submissions) && submissions.Submissions.length > 0;
        } catch {
          /* ignore */
        }
        return { f, submitted };
      }),
    );
    return withSubmitted
      .filter(({ f }) => !f.IsHidden)
      .filter(({ f }) => !since || !f.DueDate || new Date(f.DueDate) >= since)
      .map(({ f, submitted }) => ({
        externalId: String(f.Id),
        courseExternalId,
        title: f.Name,
        description: f.Description?.Text ?? undefined,
        dueAt: f.DueDate ? new Date(f.DueDate) : undefined,
        maxPoints: f.MaxPoints,
        submitted,
      }));
  }

  async getExams(
    tokens: LmsTokens,
    courseExternalId: string,
    opts?: FetchOptions,
  ): Promise<ExternalExam[]> {
    // Brightspace quizzes have their own endpoint; treat them as exams.
    try {
      const quizzes = await this.paged<{
        QuizId: number;
        Name: string;
        Description?: { Text?: string };
        StartDate?: string;
        EndDate?: string;
        DueDate?: string;
        TimeLimit?: { EnforcedTimeLimit?: number };
        InstructionsText?: { Text?: string };
      }>(tokens, `/d2l/api/le/${LE}/${courseExternalId}/quizzes/`);
      const since = opts?.since;
      return quizzes
        .filter((q) => !since || !q.StartDate || new Date(q.StartDate) >= since)
        .map((q) => ({
          externalId: String(q.QuizId),
          courseExternalId,
          title: q.Name,
          description: q.Description?.Text ?? q.InstructionsText?.Text,
          scheduledAt: q.StartDate ? new Date(q.StartDate) : undefined,
          durationMinutes: q.TimeLimit?.EnforcedTimeLimit,
        }));
    } catch (err) {
      logger.warn({ err }, 'brightspace: quizzes fetch failed');
      return [];
    }
  }

  async getAnnouncements(
    tokens: LmsTokens,
    courseExternalId: string,
    opts?: FetchOptions,
  ): Promise<ExternalAnnouncement[]> {
    const news = await this.paged<D2lNewsItem>(
      tokens,
      `/d2l/api/le/${LE}/${courseExternalId}/news/`,
    );
    const since = opts?.since;
    return news
      .filter((n) => !n.IsHidden)
      .filter((n) => !since || (n.LastModifiedDate ? new Date(n.LastModifiedDate) >= since : true))
      .map((n) => ({
        externalId: String(n.Id),
        courseExternalId,
        title: n.Title,
        body: n.Body?.Text ?? n.Body?.Html,
        postedAt: n.StartDate ? new Date(n.StartDate) : undefined,
        remoteUpdatedAt: n.LastModifiedDate ? new Date(n.LastModifiedDate) : undefined,
      }));
  }

  async getGrades(
    tokens: LmsTokens,
    courseExternalId: string,
    _opts?: FetchOptions,
  ): Promise<ExternalGrade[]> {
    const [objects, values] = await Promise.all([
      this.paged<D2lGradeObject>(tokens, `/d2l/api/le/${LE}/${courseExternalId}/grades/`),
      this.paged<D2lGradeValue>(tokens, `/d2l/api/le/${LE}/${courseExternalId}/grades/values/myGradeValues/`),
    ]);
    const objectsById = new Map(objects.map((o) => [String(o.Id), o]));
    return values
      .filter((v) => v.GradeObjectIdentifier)
      .map((v) => {
        const obj = objectsById.get(String(v.GradeObjectIdentifier));
        const score = v.PointsNumerator;
        const max = v.PointsDenominator ?? obj?.MaxPoints;
        return {
          externalId: String(v.GradeObjectIdentifier),
          courseExternalId,
          assignmentExternalId: String(v.GradeObjectIdentifier),
          label: obj?.Name ?? v.DisplayedGrade ?? 'Grade',
          score,
          maxScore: max,
          percentage: score != null && max ? (score / max) * 100 : undefined,
          letterGrade: v.DisplayedGrade,
          postedAt: v.LastModified ? new Date(v.LastModified) : v.ReleasedDate ? new Date(v.ReleasedDate) : undefined,
        };
      });
  }

  async getFiles(
    tokens: LmsTokens,
    courseExternalId: string,
    opts?: FetchOptions,
  ): Promise<ExternalFile[]> {
    // The "content topics" endpoint returns a flat list of every content topic
    // in the course (regardless of module nesting). Topics with a Url are files
    // the user can open.
    try {
      const topics = await this.paged<D2lTopic>(
        tokens,
        `/d2l/api/le/${LE}/${courseExternalId}/content/toc/topics/`,
      );
      const since = opts?.since;
      return topics
        .filter((t) => !!t.Url)
        .filter((t) => !since || (t.LastModifiedDate ? new Date(t.LastModifiedDate) >= since : true))
        .map((t) => ({
          externalId: String(t.Identifier),
          courseExternalId,
          filename: t.Title,
          url: t.Url,
          remoteUpdatedAt: t.LastModifiedDate ? new Date(t.LastModifiedDate) : undefined,
        }));
    } catch (err) {
      logger.warn({ err }, 'brightspace: content topics fetch failed');
      return [];
    }
  }

  async getCalendar(
    tokens: LmsTokens,
    courseExternalId: string,
    opts?: FetchOptions,
  ): Promise<ExternalCalendarEvent[]> {
    const start = opts?.since ?? new Date();
    const end = new Date(start.getTime() + 180 * 24 * 60 * 60 * 1000);
    try {
      const events = await this.paged<D2lCalendarEvent>(
        tokens,
        `/d2l/api/le/${LE}/${courseExternalId}/calendar/events/`,
        { startDate: start.toISOString(), endDate: end.toISOString() },
      );
      return events
        .filter((e) => !!e.StartDateTime)
        .map((e) => ({
          externalId: String(e.CalendarEventId),
          courseExternalId,
          title: e.Title,
          description: e.Description?.Text ?? e.Description?.Html,
          startAt: new Date(e.StartDateTime!),
          endAt: e.EndDateTime ? new Date(e.EndDateTime) : undefined,
          location: e.LocationName,
          type: mapEventType(e.EventType),
        }));
    } catch (err) {
      logger.warn({ err }, 'brightspace: calendar fetch failed');
      return [];
    }
  }

  // --- Internals -----------------------------------------------------------

  /**
   * Follows Brightspace's paging protocol — either the newer PagingInfo.Bookmark
   * pattern or the older "Next" URL pattern, depending on the endpoint. Returns
   * either payload.Items or payload.Objects (whichever the endpoint uses).
   */
  private async paged<T>(
    tokens: LmsTokens,
    path: string,
    query: Record<string, string> = {},
  ): Promise<T[]> {
    const base = this.cfg.portalUrl + path;
    let url = Object.keys(query).length > 0
      ? `${base}${base.includes('?') ? '&' : '?'}${new URLSearchParams(query).toString()}`
      : base;

    const results: T[] = [];
    let safety = 0;
    while (safety++ < 200) {
      const res = await this.fetchWithBackoff(url, {
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
          Accept: 'application/json',
        },
      });
      const raw = await res.json();
      // Endpoints without Items/Objects are treated as a single-page array.
      if (Array.isArray(raw)) {
        results.push(...(raw as T[]));
        break;
      }
      const payload = raw as D2lPagedResult<T>;
      if (Array.isArray(payload.Items)) results.push(...payload.Items);
      if (Array.isArray(payload.Objects)) results.push(...payload.Objects);
      if (payload.PagingInfo?.HasMoreItems && payload.PagingInfo?.Bookmark) {
        const sep = base.includes('?') ? '&' : '?';
        url = `${base}${sep}bookmark=${encodeURIComponent(payload.PagingInfo.Bookmark)}`;
        continue;
      }
      if (payload.Next) {
        url = payload.Next.startsWith('http') ? payload.Next : this.cfg.portalUrl + payload.Next;
        continue;
      }
      break;
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
      throw new LmsProviderError(
        this.provider,
        `HTTP ${res.status} at ${url}: ${(await res.text()).slice(0, 200)}`,
        res.status,
      );
    }
    return res;
  }
}

function mapEventType(t: string | undefined): ExternalCalendarEvent['type'] {
  const key = (t ?? '').toLowerCase();
  if (key.includes('lab')) return 'lab';
  if (key.includes('exam') || key.includes('quiz')) return 'exam';
  if (key.includes('lecture')) return 'lecture';
  if (key.includes('office')) return 'office_hours';
  if (key.includes('due') || key.includes('deadline')) return 'deadline';
  return 'other';
}
