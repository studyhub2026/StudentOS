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
 * Microsoft Teams for Education adapter — implemented against the Microsoft
 * Graph API. Auth is OAuth2 via the Microsoft identity platform (v2 endpoint,
 * `common` tenant so any school AAD works).
 *
 *   https://learn.microsoft.com/en-us/graph/api/resources/educationclass
 *
 * We use the multi-tenant `common` authority so students at different schools
 * can sign in with the same app registration. Graph enforces per-tenant admin
 * consent for the education scopes so the app has to be approved once per
 * school; this is standard for MS Graph.
 *
 * Files: OneDrive-backed. Each class has a SharePoint site whose Files tab is
 * a drive. We enumerate the drive's root items — that's the "Class Materials"
 * area students see in Teams.
 */

const AUTHORITY = 'https://login.microsoftonline.com/common/oauth2/v2.0';
const AUTHORIZE_URL = `${AUTHORITY}/authorize`;
const TOKEN_URL = `${AUTHORITY}/token`;
const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

const SCOPES = [
  'openid',
  'profile',
  'email',
  'offline_access',
  'User.Read',
  'EduRoster.ReadBasic',
  'EduAssignments.ReadBasic',
  'EduAssignments.ReadWriteSelf',
  'Team.ReadBasic.All',
  'Files.Read.All',
  'Calendars.Read',
  'ChannelMessage.Read.All',
].join(' ');

// --- Graph response shapes (partial) -----------------------------------------

interface GraphUser {
  id: string;
  displayName?: string;
  mail?: string;
  userPrincipalName?: string;
  jobTitle?: string;
  givenName?: string;
  surname?: string;
}

interface EduClass {
  id: string;
  displayName: string;
  mailNickname?: string;
  description?: string;
  externalId?: string;
  createdDateTime?: string;
  classCode?: string;
  externalName?: string;
  externalSource?: string;
  term?: { displayName?: string; startDate?: string; endDate?: string };
}

interface EduAssignment {
  id: string;
  classId: string;
  displayName: string;
  instructions?: { content?: string; contentType?: string };
  dueDateTime?: string;
  createdDateTime?: string;
  lastModifiedDateTime?: string;
  grading?: { maxPoints?: number };
  status?: 'draft' | 'published' | 'assigned' | 'inactive';
  webUrl?: string;
}

interface EduSubmissionOutcome {
  points?: { grade?: number };
  feedback?: { text?: { content?: string } };
}

interface EduSubmission {
  id: string;
  status?: 'working' | 'submitted' | 'returned' | 'reassigned';
  submittedDateTime?: string;
  returnedDateTime?: string;
  outcomes?: { value: EduSubmissionOutcome[] };
}

interface Team {
  id: string;
  displayName: string;
  description?: string;
  createdDateTime?: string;
  webUrl?: string;
}

interface ChannelMessage {
  id: string;
  subject?: string;
  body?: { content?: string; contentType?: string };
  from?: { user?: { displayName?: string } };
  createdDateTime?: string;
  lastModifiedDateTime?: string;
  webUrl?: string;
}

interface DriveItem {
  id: string;
  name: string;
  webUrl?: string;
  size?: number;
  file?: { mimeType?: string };
  folder?: unknown;
  lastModifiedDateTime?: string;
}

interface CalendarEvent {
  id: string;
  subject: string;
  bodyPreview?: string;
  location?: { displayName?: string };
  start?: { dateTime?: string; timeZone?: string };
  end?: { dateTime?: string; timeZone?: string };
  isAllDay?: boolean;
  webLink?: string;
}

interface GraphListEnvelope<T> {
  '@odata.nextLink'?: string;
  value: T[];
}

interface AadTokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  id_token?: string;
}

export class MsTeamsAdapter implements LmsAdapter {
  readonly provider = LmsProvider.MS_TEAMS;
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
      response_mode: 'query',
      scope: SCOPES,
      state,
      // Common practice: force consent so newly-added scopes actually get
      // granted rather than silently missing.
      prompt: 'consent',
    });
    return `${AUTHORIZE_URL}?${params.toString()}`;
  }

  async authenticate(code: string): Promise<LmsTokens> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.cfg.redirectUri,
      client_id: this.cfg.clientId,
      client_secret: this.cfg.clientSecret,
      scope: SCOPES,
    });
    return this.tokenExchange(body);
  }

  async refresh(refreshToken: string): Promise<LmsRefreshResult> {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: this.cfg.clientId,
      client_secret: this.cfg.clientSecret,
      scope: SCOPES,
    });
    const tokens = await this.tokenExchange(body);
    const rotated = Boolean(tokens.refreshToken && tokens.refreshToken !== refreshToken);
    return {
      tokens: { ...tokens, refreshToken: tokens.refreshToken ?? refreshToken },
      rotated,
    };
  }

  async revoke(_tokens: LmsTokens): Promise<void> {
    // AAD tokens can only be revoked by the user through their account portal.
    // The v2 endpoint doesn't have a machine-facing revoke API. No-op.
    return;
  }

  private async tokenExchange(body: URLSearchParams): Promise<LmsTokens> {
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
    const json = (await res.json()) as AadTokenResponse;
    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      expiresAt: json.expires_in ? new Date(Date.now() + json.expires_in * 1000) : undefined,
    };
  }

  // --- Data fetchers -------------------------------------------------------

  async getProfile(tokens: LmsTokens): Promise<LmsProfile> {
    const me = await this.request<GraphUser>(tokens, '/me');
    const composed = [me.givenName, me.surname].filter(Boolean).join(' ');
    const name = me.displayName || composed || me.userPrincipalName || 'MS user';
    return {
      remoteUserId: me.id,
      name,
      email: me.mail ?? me.userPrincipalName,
      program: me.jobTitle,
      raw: me as unknown as Record<string, unknown>,
    };
  }

  async getCourses(tokens: LmsTokens, _opts?: FetchOptions): Promise<ExternalCourse[]> {
    // Education Roster surfaces the user's classes with proper metadata
    // (classCode, term, teachers). Fall back to plain groups+teams if the
    // EduRoster scope isn't granted, so the user still sees SOMETHING.
    try {
      const classes = await this.paged<EduClass>(tokens, '/education/me/classes');
      return classes.map((c) => ({
        externalId: c.id,
        name: c.displayName,
        code: c.classCode ?? c.mailNickname,
        term: c.term?.displayName,
        active: true,
        remoteUpdatedAt: c.createdDateTime ? new Date(c.createdDateTime) : undefined,
      }));
    } catch (err) {
      logger.warn({ err }, 'ms-teams: /education/me/classes failed, falling back to /me/joinedTeams');
      const teams = await this.paged<Team>(tokens, '/me/joinedTeams');
      return teams.map((t) => ({
        externalId: t.id,
        name: t.displayName,
        active: true,
        remoteUpdatedAt: t.createdDateTime ? new Date(t.createdDateTime) : undefined,
      }));
    }
  }

  async getAssignments(
    tokens: LmsTokens,
    courseExternalId: string,
    opts?: FetchOptions,
  ): Promise<ExternalAssignment[]> {
    const items = await this.paged<EduAssignment>(
      tokens,
      `/education/classes/${courseExternalId}/assignments`,
    ).catch(() => [] as EduAssignment[]);

    // Fetch the user's own submissions per assignment (in parallel with a
    // small cap) to flag `submitted` — Graph doesn't expose a per-user
    // bulk endpoint for education submissions.
    const withSubmitted = await Promise.all(
      items.map(async (a) => {
        let submitted = false;
        try {
          const subs = await this.paged<EduSubmission>(
            tokens,
            `/education/classes/${courseExternalId}/assignments/${a.id}/submissions?$filter=submittedBy/user/id eq '${await this.userId(tokens)}'`,
          );
          submitted = subs.some((s) => s.status === 'submitted' || s.status === 'returned');
        } catch {
          /* ignore */
        }
        return { a, submitted };
      }),
    );

    const since = opts?.since;
    return withSubmitted
      .filter(({ a }) => a.status !== 'draft' && a.status !== 'inactive')
      .filter(({ a }) =>
        !since || (a.lastModifiedDateTime ? new Date(a.lastModifiedDateTime) >= since : true),
      )
      .map(({ a, submitted }) => ({
        externalId: a.id,
        courseExternalId,
        title: a.displayName,
        description: a.instructions?.content,
        dueAt: a.dueDateTime ? new Date(a.dueDateTime) : undefined,
        maxPoints: a.grading?.maxPoints,
        url: a.webUrl,
        submitted,
        remoteUpdatedAt: a.lastModifiedDateTime ? new Date(a.lastModifiedDateTime) : undefined,
      }));
  }

  async getExams(
    _tokens: LmsTokens,
    _courseExternalId: string,
    _opts?: FetchOptions,
  ): Promise<ExternalExam[]> {
    // Teams doesn't have a first-class "exam" concept — exams are usually
    // Forms Quizzes attached as assignments and already surface through
    // getAssignments.
    return [];
  }

  async getAnnouncements(
    tokens: LmsTokens,
    courseExternalId: string,
    opts?: FetchOptions,
  ): Promise<ExternalAnnouncement[]> {
    // Announcements = messages in the class Team's General channel that carry
    // a Subject. Requires the ChannelMessage.Read.All scope, which many
    // school tenants restrict; wrap in try/catch so a lack of consent doesn't
    // fail the whole sync.
    try {
      // The class id (from /education/classes) is the same as the group id, and
      // /teams/{id}/channels returns General as the first channel.
      const channels = await this.request<GraphListEnvelope<{ id: string; displayName: string }>>(
        tokens,
        `/teams/${courseExternalId}/channels`,
      );
      const general = channels.value.find((c) => c.displayName.toLowerCase() === 'general') ?? channels.value[0];
      if (!general) return [];
      const messages = await this.paged<ChannelMessage>(
        tokens,
        `/teams/${courseExternalId}/channels/${general.id}/messages`,
      );
      const since = opts?.since;
      return messages
        .filter((m) => !!m.subject && m.subject.trim().length > 0)
        .filter((m) =>
          !since ||
          (m.lastModifiedDateTime ? new Date(m.lastModifiedDateTime) >= since : true),
        )
        .slice(0, 100)
        .map((m) => ({
          externalId: m.id,
          courseExternalId,
          title: m.subject ?? 'Announcement',
          body: stripHtml(m.body?.content),
          author: m.from?.user?.displayName,
          postedAt: m.createdDateTime ? new Date(m.createdDateTime) : undefined,
          url: m.webUrl,
          remoteUpdatedAt: m.lastModifiedDateTime ? new Date(m.lastModifiedDateTime) : undefined,
        }));
    } catch (err) {
      logger.warn({ err }, 'ms-teams: announcements fetch failed (scope may be missing)');
      return [];
    }
  }

  async getGrades(
    tokens: LmsTokens,
    courseExternalId: string,
    _opts?: FetchOptions,
  ): Promise<ExternalGrade[]> {
    // Graph education grading: outcomes on returned submissions carry a
    // `points.grade` (numeric) or `feedback.grade` (rubric). We surface the
    // numeric ones as grades.
    try {
      const assignments = await this.paged<EduAssignment>(
        tokens,
        `/education/classes/${courseExternalId}/assignments`,
      );
      const uid = await this.userId(tokens);
      const grades: ExternalGrade[] = [];
      for (const a of assignments) {
        try {
          const subs = await this.paged<EduSubmission>(
            tokens,
            `/education/classes/${courseExternalId}/assignments/${a.id}/submissions?$filter=submittedBy/user/id eq '${uid}'&$expand=outcomes`,
          );
          for (const sub of subs) {
            const pt = sub.outcomes?.value?.find((o) => o?.points?.grade != null)?.points?.grade;
            if (pt == null) continue;
            grades.push({
              externalId: `sub-${sub.id}`,
              courseExternalId,
              assignmentExternalId: a.id,
              label: a.displayName,
              score: pt,
              maxScore: a.grading?.maxPoints,
              percentage: a.grading?.maxPoints ? (pt / a.grading.maxPoints) * 100 : undefined,
              postedAt: sub.returnedDateTime ? new Date(sub.returnedDateTime) : undefined,
            });
          }
        } catch {
          /* per-assignment failures don't break the whole set */
        }
      }
      return grades;
    } catch (err) {
      logger.warn({ err }, 'ms-teams: grades fetch failed');
      return [];
    }
  }

  async getFiles(
    tokens: LmsTokens,
    courseExternalId: string,
    opts?: FetchOptions,
  ): Promise<ExternalFile[]> {
    // The Team's SharePoint site has a Files tab backed by a drive. Enumerate
    // the drive's root items (skipping folders) — that's the class materials.
    try {
      const drive = await this.request<{ id: string }>(
        tokens,
        `/groups/${courseExternalId}/drive`,
      );
      const items = await this.paged<DriveItem>(
        tokens,
        `/drives/${drive.id}/root/children`,
      );
      const since = opts?.since;
      return items
        .filter((it) => !!it.file)
        .filter((it) => !since || (it.lastModifiedDateTime ? new Date(it.lastModifiedDateTime) >= since : true))
        .map((it) => ({
          externalId: it.id,
          courseExternalId,
          filename: it.name,
          mimeType: it.file?.mimeType,
          sizeBytes: it.size,
          url: it.webUrl,
          remoteUpdatedAt: it.lastModifiedDateTime ? new Date(it.lastModifiedDateTime) : undefined,
        }));
    } catch (err) {
      logger.warn({ err }, 'ms-teams: files fetch failed');
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
      // Team-level calendar. Some tenants restrict this — fall back to the
      // user's own /me/calendarView so we still return something.
      const groupEvents = await this.paged<CalendarEvent>(
        tokens,
        `/groups/${courseExternalId}/calendarView?startDateTime=${start.toISOString()}&endDateTime=${end.toISOString()}`,
      ).catch(() => [] as CalendarEvent[]);
      return groupEvents
        .filter((e) => !!e.start?.dateTime)
        .map((e) => ({
          externalId: e.id,
          courseExternalId,
          title: e.subject,
          description: e.bodyPreview,
          startAt: new Date(e.start!.dateTime!),
          endAt: e.end?.dateTime ? new Date(e.end.dateTime) : undefined,
          location: e.location?.displayName,
          type: 'lecture' as const,
          url: e.webLink,
        }));
    } catch (err) {
      logger.warn({ err }, 'ms-teams: calendar fetch failed');
      return [];
    }
  }

  // --- Internals -----------------------------------------------------------

  private cachedUserId: string | null = null;

  private async userId(tokens: LmsTokens): Promise<string> {
    if (this.cachedUserId) return this.cachedUserId;
    const me = await this.request<GraphUser>(tokens, '/me');
    this.cachedUserId = me.id;
    return me.id;
  }

  private async paged<T>(tokens: LmsTokens, path: string): Promise<T[]> {
    let url = path.startsWith('http') ? path : GRAPH_BASE + path;
    const results: T[] = [];
    let safety = 0;
    while (safety++ < 200) {
      const res = await this.fetchWithBackoff(url, {
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
          Accept: 'application/json',
        },
      });
      const payload = (await res.json()) as GraphListEnvelope<T>;
      if (Array.isArray(payload.value)) results.push(...payload.value);
      const next = payload['@odata.nextLink'];
      if (!next) break;
      url = next;
    }
    return results;
  }

  private async request<T>(tokens: LmsTokens, path: string): Promise<T> {
    const url = path.startsWith('http') ? path : GRAPH_BASE + path;
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
      // Graph 429 responses ship a Retry-After header — honour it when present.
      const retryAfter = res.headers.get('retry-after');
      const wait = retryAfter
        ? Math.min(Number(retryAfter) * 1000, 8000)
        : Math.min(2 ** attempt * 500, 4000);
      if (attempt < 3) {
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

function stripHtml(html?: string): string | undefined {
  if (!html) return undefined;
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}
