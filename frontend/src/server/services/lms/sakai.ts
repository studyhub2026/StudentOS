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
 * Sakai adapter — real implementation against Sakai's Entity Broker REST API.
 * Auth uses OAuth 2.0 (`server/oauth/*`), which most Sakai 20+ deployments
 * expose. Older Sakai installs used a session-cookie ("login/handle") flow
 * that isn't safe for a third-party app; those aren't supported here — the
 * institution has to enable the OAuth server bundle.
 *
 *   https://www.sakailms.org/documentation
 *
 * Every Entity Broker endpoint returns JSON when suffixed with `.json`. That
 * suffix is added here rather than via an `Accept` header because the parser
 * on some Sakai versions ignores the header and returns XML.
 */

const SCOPES = 'read';

interface SakaiOAuthTokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
}

interface SakaiUser {
  id: string;
  eid?: string;
  email?: string;
  displayName?: string;
  firstName?: string;
  lastName?: string;
  type?: string;
}

interface SakaiSite {
  id: string;
  title: string;
  description?: string;
  shortDescription?: string;
  type?: string;
  published?: boolean;
  createdDate?: string;
  modifiedDate?: string;
  props?: Record<string, string>;
}

interface SakaiAssignment {
  id: string;
  entityId?: string;
  context?: string;
  title: string;
  instructions?: string;
  dueTime?: { epochSecond?: number };
  dueTimeString?: string;
  openTime?: { epochSecond?: number };
  closeTime?: { epochSecond?: number };
  maxGradePoint?: string;
  gradeType?: number;
  status?: string;
}

interface SakaiSubmission {
  id: string;
  assignmentId: string;
  userId: string;
  submitted?: boolean;
  graded?: boolean;
  grade?: string;
  timeSubmitted?: string;
  timeReturned?: string;
  feedbackText?: string;
}

interface SakaiAnnouncement {
  announcementId: string;
  title: string;
  body?: string;
  createdByDisplayName?: string;
  createdOn?: number;
  modifiedOn?: number;
}

interface SakaiContentItem {
  entityId?: string;
  id?: string;
  name?: string;
  title?: string;
  url?: string;
  container?: string;
  contentType?: string;
  contentLength?: number;
  modifiedDate?: string;
  isCollection?: boolean;
}

interface SakaiCalendarEvent {
  eventId: string;
  title: string;
  description?: string;
  location?: string;
  type?: string;
  firstTime?: { epochSecond?: number };
  duration?: number;
  siteId?: string;
}

interface SakaiListEnvelope<T> {
  entityPrefix?: string;
  [key: string]: T[] | string | undefined;
}

export class SakaiAdapter implements LmsAdapter {
  readonly provider = LmsProvider.SAKAI;
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
      scope: SCOPES,
      state,
    });
    return `${this.cfg.portalUrl}/oauth/authorize?${params.toString()}`;
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

  async revoke(tokens: LmsTokens): Promise<void> {
    try {
      await fetch(`${this.cfg.portalUrl}/oauth/revoke`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${Buffer.from(`${this.cfg.clientId}:${this.cfg.clientSecret}`).toString('base64')}`,
        },
        body: new URLSearchParams({ token: tokens.accessToken }),
      });
    } catch (err) {
      logger.warn({ err }, 'sakai: revoke failed (non-fatal)');
    }
  }

  private async tokenExchange(body: URLSearchParams): Promise<LmsTokens> {
    body.set('client_id', this.cfg.clientId);
    body.set('client_secret', this.cfg.clientSecret);
    const res = await fetch(`${this.cfg.portalUrl}/oauth/token`, {
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
    const json = (await res.json()) as SakaiOAuthTokenResponse;
    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      expiresAt: json.expires_in ? new Date(Date.now() + json.expires_in * 1000) : undefined,
    };
  }

  // --- Data fetchers -------------------------------------------------------

  async getProfile(tokens: LmsTokens): Promise<LmsProfile> {
    const user = await this.request<SakaiUser>(tokens, '/direct/user/current.json');
    const composed = [user.firstName, user.lastName].filter(Boolean).join(' ');
    const name = user.displayName || composed || user.eid || 'Sakai user';
    return {
      remoteUserId: user.id,
      name,
      email: user.email,
      raw: user as unknown as Record<string, unknown>,
    };
  }

  async getCourses(tokens: LmsTokens, _opts?: FetchOptions): Promise<ExternalCourse[]> {
    const sites = await this.list<SakaiSite>(
      tokens,
      '/direct/site.json?_limit=200',
      'site_collection',
    );
    // Sakai returns every site the user has ever been in, including personal
    // workspace and admin sites. Filter to "course" and published only.
    const courseSites = sites.filter((s) => s.type === 'course' && s.published !== false);
    return courseSites.map((s) => ({
      externalId: s.id,
      name: s.title,
      code: s.shortDescription,
      active: s.published !== false,
      remoteUpdatedAt: s.modifiedDate ? new Date(s.modifiedDate) : undefined,
    }));
  }

  async getAssignments(
    tokens: LmsTokens,
    courseExternalId: string,
    opts?: FetchOptions,
  ): Promise<ExternalAssignment[]> {
    const items = await this.list<SakaiAssignment>(
      tokens,
      `/direct/assignment/site/${courseExternalId}.json`,
      'assignment_collection',
    );
    // Fetch this user's submissions once so we can flag `submitted`.
    let submitted = new Set<string>();
    try {
      const subs = await this.list<SakaiSubmission>(
        tokens,
        `/direct/assignment/mySubmissions/${courseExternalId}.json`,
        'assignment_submission_collection',
      );
      submitted = new Set(subs.filter((s) => s.submitted).map((s) => s.assignmentId));
    } catch {
      /* older Sakai versions don't expose mySubmissions — skip flagging */
    }
    const since = opts?.since;
    return items
      .filter((a) => a.status !== 'DRAFT')
      .filter((a) => {
        if (!since) return true;
        const due = epochToDate(a.dueTime?.epochSecond);
        return !due || due >= since;
      })
      .map((a) => ({
        externalId: a.id,
        courseExternalId,
        title: a.title,
        description: a.instructions,
        dueAt: epochToDate(a.dueTime?.epochSecond),
        maxPoints: a.maxGradePoint ? Number(a.maxGradePoint) : undefined,
        submitted: submitted.has(a.id),
      }));
  }

  async getExams(
    _tokens: LmsTokens,
    _courseExternalId: string,
    _opts?: FetchOptions,
  ): Promise<ExternalExam[]> {
    // Sakai's Tests & Quizzes tool (Samigo) has a separate endpoint that
    // requires an admin-installed extension in most deployments. Skip cleanly;
    // most institutions surface exams via assignments anyway.
    return [];
  }

  async getAnnouncements(
    tokens: LmsTokens,
    courseExternalId: string,
    opts?: FetchOptions,
  ): Promise<ExternalAnnouncement[]> {
    const items = await this.list<SakaiAnnouncement>(
      tokens,
      `/direct/announcement/site/${courseExternalId}.json`,
      'announcement_collection',
    );
    const since = opts?.since;
    return items
      .filter((a) => !since || (a.modifiedOn && new Date(a.modifiedOn) >= since))
      .map((a) => ({
        externalId: a.announcementId,
        courseExternalId,
        title: a.title,
        body: a.body,
        author: a.createdByDisplayName,
        postedAt: a.createdOn ? new Date(a.createdOn) : undefined,
        remoteUpdatedAt: a.modifiedOn ? new Date(a.modifiedOn) : undefined,
      }));
  }

  async getGrades(
    tokens: LmsTokens,
    courseExternalId: string,
    _opts?: FetchOptions,
  ): Promise<ExternalGrade[]> {
    try {
      const subs = await this.list<SakaiSubmission>(
        tokens,
        `/direct/assignment/mySubmissions/${courseExternalId}.json`,
        'assignment_submission_collection',
      );
      return subs
        .filter((s) => s.graded && s.grade)
        .map((s) => ({
          externalId: s.id,
          courseExternalId,
          assignmentExternalId: s.assignmentId,
          label: `Submission ${s.id}`,
          score: Number(s.grade),
          maxScore: undefined,
          percentage: undefined,
          letterGrade: undefined,
          postedAt: s.timeReturned ? new Date(s.timeReturned) : undefined,
        }));
    } catch (err) {
      logger.warn({ err }, 'sakai: mySubmissions/grades fetch failed');
      return [];
    }
  }

  async getFiles(
    tokens: LmsTokens,
    courseExternalId: string,
    opts?: FetchOptions,
  ): Promise<ExternalFile[]> {
    try {
      const items = await this.list<SakaiContentItem>(
        tokens,
        `/direct/content/site/${courseExternalId}.json?depth=2`,
        'content_collection',
      );
      const since = opts?.since;
      return items
        .filter((c) => !c.isCollection)
        .filter((c) => !since || !c.modifiedDate || new Date(c.modifiedDate) >= since)
        .map((c) => ({
          externalId: c.entityId ?? c.id ?? c.name ?? '',
          courseExternalId,
          filename: c.name ?? c.title ?? 'file',
          mimeType: c.contentType,
          sizeBytes: c.contentLength,
          url: c.url,
          remoteUpdatedAt: c.modifiedDate ? new Date(c.modifiedDate) : undefined,
        }));
    } catch (err) {
      logger.warn({ err }, 'sakai: content list failed');
      return [];
    }
  }

  async getCalendar(
    tokens: LmsTokens,
    courseExternalId: string,
    opts?: FetchOptions,
  ): Promise<ExternalCalendarEvent[]> {
    try {
      const events = await this.list<SakaiCalendarEvent>(
        tokens,
        `/direct/calendar/site/${courseExternalId}.json`,
        'calendar_collection',
      );
      const since = opts?.since;
      return events
        .filter((e) => !!e.firstTime?.epochSecond)
        .filter((e) => {
          if (!since) return true;
          const start = epochToDate(e.firstTime?.epochSecond);
          return !start || start >= since;
        })
        .map((e) => {
          const startAt = epochToDate(e.firstTime?.epochSecond)!;
          const endAt = e.duration ? new Date(startAt.getTime() + e.duration * 1000) : undefined;
          return {
            externalId: e.eventId,
            courseExternalId,
            title: e.title,
            description: e.description,
            startAt,
            endAt,
            location: e.location,
            type: mapEventType(e.type),
          };
        });
    } catch (err) {
      logger.warn({ err }, 'sakai: calendar fetch failed');
      return [];
    }
  }

  // --- Internals -----------------------------------------------------------

  /**
   * Sakai's Entity Broker wraps list responses in `{ [entityPrefix]_collection: [] }`
   * where the key varies per endpoint. We accept the expected key up-front but
   * fall back to any array-valued property so this helper works across the
   * inconsistent variants (announcements, calendar, and content each use
   * slightly different envelope shapes).
   */
  private async list<T>(tokens: LmsTokens, path: string, arrayKey: string): Promise<T[]> {
    const raw = await this.request<SakaiListEnvelope<T>>(tokens, path);
    const primary = raw[arrayKey];
    if (Array.isArray(primary)) return primary;
    // Fallback: pick the first array-valued property.
    for (const v of Object.values(raw)) {
      if (Array.isArray(v)) return v as T[];
    }
    return [];
  }

  private async request<T>(tokens: LmsTokens, path: string): Promise<T> {
    const url = this.cfg.portalUrl + path;
    const res = await this.fetchWithBackoff(url, {
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
        `HTTP ${res.status} at ${url} — token expired`,
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

function epochToDate(epoch: number | undefined): Date | undefined {
  if (!epoch || !Number.isFinite(epoch)) return undefined;
  // Sakai returns epoch in seconds; guard against values already in ms.
  return new Date(epoch < 1e12 ? epoch * 1000 : epoch);
}

function mapEventType(t: string | undefined): ExternalCalendarEvent['type'] {
  const key = (t ?? '').toLowerCase();
  if (key.includes('lab')) return 'lab';
  if (key.includes('exam') || key.includes('quiz')) return 'exam';
  if (key.includes('lecture') || key.includes('class')) return 'lecture';
  if (key.includes('office')) return 'office_hours';
  if (key.includes('due') || key.includes('deadline')) return 'deadline';
  return 'other';
}
