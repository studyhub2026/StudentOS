import { afterEach, describe, expect, it, vi } from 'vitest';
import { GoogleClassroomAdapter, gcDueToDate } from './google-classroom';

const cfg = {
  portalUrl: 'https://classroom.google.com',
  redirectUri: 'https://app.local/api/v1/university/oauth/google-classroom/callback',
  clientId: 'google-client-123',
  clientSecret: 'google-secret-456',
};

const tokens = { accessToken: 'gc-token-abc' };

/**
 * Same helper the other adapter test files use: serve a queue of responses
 * (raw objects → 200 JSON, or {status, body} pairs) in FIFO order.
 */
function mockFetchQueue(entries: Array<unknown | { status: number; body?: unknown }>) {
  let idx = 0;
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    const entry = entries[idx++];
    if (entry === undefined) throw new Error(`fetch called more times than mocked (${idx})`);
    if (entry instanceof Response) return entry;
    if (
      entry &&
      typeof entry === 'object' &&
      'status' in (entry as Record<string, unknown>) &&
      typeof (entry as { status: unknown }).status === 'number'
    ) {
      const e = entry as { status: number; body?: unknown };
      return new Response(e.body != null ? JSON.stringify(e.body) : '', { status: e.status });
    }
    return new Response(JSON.stringify(entry), { status: 200 });
  });
  return spy;
}

describe('GoogleClassroomAdapter', () => {
  afterEach(() => vi.restoreAllMocks());

  describe('gcDueToDate helper', () => {
    it('returns undefined when there is no dueDate', () => {
      expect(gcDueToDate(undefined, undefined)).toBeUndefined();
    });
    it('defaults time to 23:59 UTC when dueDate has no dueTime', () => {
      const d = gcDueToDate({ year: 2026, month: 3, day: 15 }, undefined);
      expect(d).toBeInstanceOf(Date);
      expect(d!.getUTCFullYear()).toBe(2026);
      expect(d!.getUTCMonth()).toBe(2); // 0-indexed
      expect(d!.getUTCDate()).toBe(15);
      expect(d!.getUTCHours()).toBe(23);
      expect(d!.getUTCMinutes()).toBe(59);
    });
    it('combines dueDate + dueTime correctly', () => {
      const d = gcDueToDate({ year: 2026, month: 6, day: 1 }, { hours: 14, minutes: 30 });
      expect(d!.getUTCHours()).toBe(14);
      expect(d!.getUTCMinutes()).toBe(30);
    });
  });

  describe('OAuth', () => {
    it('authorize URL includes the required scopes and offline access', () => {
      const adapter = new GoogleClassroomAdapter(cfg);
      const url = new URL(adapter.getAuthorizeUrl('state-abc'));
      expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
      expect(url.searchParams.get('client_id')).toBe('google-client-123');
      expect(url.searchParams.get('response_type')).toBe('code');
      expect(url.searchParams.get('redirect_uri')).toBe(cfg.redirectUri);
      expect(url.searchParams.get('state')).toBe('state-abc');
      // offline access + consent prompt are required to reliably get a refresh_token.
      expect(url.searchParams.get('access_type')).toBe('offline');
      expect(url.searchParams.get('prompt')).toBe('consent');
      // Must include Classroom-specific scopes.
      const scope = url.searchParams.get('scope') ?? '';
      expect(scope).toContain('classroom.courses.readonly');
      expect(scope).toContain('classroom.coursework.me');
      expect(scope).toContain('classroom.announcements.readonly');
      expect(scope).toContain('classroom.student-submissions.me.readonly');
    });

    it('exchanges an authorization code for tokens', async () => {
      const spy = mockFetchQueue([
        {
          access_token: 'access-1',
          refresh_token: 'refresh-1',
          expires_in: 3599,
          token_type: 'Bearer',
        },
      ]);
      const adapter = new GoogleClassroomAdapter(cfg);
      const result = await adapter.authenticate('the-code');
      expect(result.accessToken).toBe('access-1');
      expect(result.refreshToken).toBe('refresh-1');
      expect(result.expiresAt).toBeInstanceOf(Date);
      const [url, init] = spy.mock.calls[0]!;
      expect(url).toBe('https://oauth2.googleapis.com/token');
      const body = String((init as RequestInit).body);
      expect(body).toContain('grant_type=authorization_code');
      expect(body).toContain('code=the-code');
      expect(body).toContain('client_id=google-client-123');
    });

    it('refresh keeps the same refresh_token when Google does not rotate it', async () => {
      mockFetchQueue([{ access_token: 'access-2', expires_in: 3599 }]);
      const adapter = new GoogleClassroomAdapter(cfg);
      const { tokens: result, rotated } = await adapter.refresh('refresh-1');
      expect(result.accessToken).toBe('access-2');
      expect(result.refreshToken).toBe('refresh-1');
      expect(rotated).toBe(false);
    });

    it('refresh reports rotated=true when a new refresh_token comes back', async () => {
      mockFetchQueue([
        { access_token: 'access-2', refresh_token: 'refresh-2', expires_in: 3599 },
      ]);
      const adapter = new GoogleClassroomAdapter(cfg);
      const { tokens: result, rotated } = await adapter.refresh('refresh-1');
      expect(result.refreshToken).toBe('refresh-2');
      expect(rotated).toBe(true);
    });
  });

  describe('getProfile', () => {
    it('maps Google userinfo to LmsProfile via the OpenID endpoint', async () => {
      const spy = mockFetchQueue([
        {
          sub: '108234567890',
          name: 'Ahmed Argawi',
          email: 'ahmed@ciu.edu.tr',
          picture: 'https://lh3.googleusercontent.com/a/abc',
        },
      ]);
      const adapter = new GoogleClassroomAdapter(cfg);
      const profile = await adapter.getProfile(tokens);
      expect(profile).toMatchObject({
        remoteUserId: '108234567890',
        name: 'Ahmed Argawi',
        email: 'ahmed@ciu.edu.tr',
        avatarUrl: 'https://lh3.googleusercontent.com/a/abc',
      });
      const [url] = spy.mock.calls[0]!;
      expect(String(url)).toBe('https://www.googleapis.com/oauth2/v3/userinfo');
    });
  });

  describe('getCourses', () => {
    it('lists active courses with teacher lookup', async () => {
      mockFetchQueue([
        // Page 1 of /courses
        {
          courses: [
            {
              id: '12345',
              name: 'Thermodynamics',
              section: 'ME-201',
              courseState: 'ACTIVE',
              updateTime: '2026-01-15T10:00:00Z',
            },
            {
              id: '67890',
              name: 'Old Course',
              section: 'CS-101',
              courseState: 'ARCHIVED',
              updateTime: '2025-01-15T10:00:00Z',
            },
          ],
        },
        // Teachers for course 12345
        { teachers: [{ userId: 't1', profile: { name: { fullName: 'Dr. Carnot' } } }] },
        // Teachers for course 67890
        { teachers: [] },
      ]);
      const adapter = new GoogleClassroomAdapter(cfg);
      const courses = await adapter.getCourses(tokens);
      expect(courses).toHaveLength(2);
      expect(courses[0]).toMatchObject({
        externalId: '12345',
        name: 'Thermodynamics',
        code: 'ME-201',
        active: true,
        instructor: 'Dr. Carnot',
      });
      expect(courses[1]!.active).toBe(false);
    });

    it('follows nextPageToken until exhausted', async () => {
      mockFetchQueue([
        { courses: [{ id: 'a', name: 'C1', courseState: 'ACTIVE' }], nextPageToken: 'p2' },
        { courses: [{ id: 'b', name: 'C2', courseState: 'ACTIVE' }] },
        // Teacher lookups for each course (empty)
        { teachers: [] },
        { teachers: [] },
      ]);
      const adapter = new GoogleClassroomAdapter(cfg);
      const courses = await adapter.getCourses(tokens);
      expect(courses.map((c) => c.externalId)).toEqual(['a', 'b']);
    });
  });

  describe('getAssignments', () => {
    it('maps courseWork + flags submitted assignments', async () => {
      mockFetchQueue([
        // courseWork list
        {
          courseWork: [
            {
              courseId: '12345',
              id: 'cw-1',
              title: 'Homework 1',
              description: 'Do stuff',
              maxPoints: 100,
              workType: 'ASSIGNMENT',
              dueDate: { year: 2026, month: 8, day: 15 },
              dueTime: { hours: 23, minutes: 59 },
              updateTime: '2026-08-01T10:00:00Z',
              alternateLink: 'https://classroom.google.com/c/12345/a/cw-1',
            },
            {
              courseId: '12345',
              id: 'cw-2',
              title: 'Quiz 1',
              workType: 'MULTIPLE_CHOICE_QUESTION',
              updateTime: '2026-08-02T10:00:00Z',
            },
          ],
        },
        // studentSubmissions for /courseWork/-/studentSubmissions
        {
          studentSubmissions: [
            { courseWorkId: 'cw-1', id: 's1', state: 'TURNED_IN' },
            { courseWorkId: 'cw-2', id: 's2', state: 'NEW' },
          ],
        },
      ]);
      const adapter = new GoogleClassroomAdapter(cfg);
      const items = await adapter.getAssignments(tokens, '12345');
      expect(items).toHaveLength(2);
      expect(items[0]).toMatchObject({
        externalId: 'cw-1',
        title: 'Homework 1',
        maxPoints: 100,
        type: 'assignment',
        submitted: true,
      });
      expect(items[0]!.dueAt).toBeInstanceOf(Date);
      // Quiz work types get mapped to 'quiz' so the sync engine can distinguish.
      expect(items[1]!.type).toBe('quiz');
      expect(items[1]!.submitted).toBe(false);
    });

    it('respects the incremental since filter', async () => {
      const since = new Date('2026-08-01T00:00:00Z');
      mockFetchQueue([
        {
          courseWork: [
            { id: 'old', title: 'Old', updateTime: '2026-07-01T10:00:00Z' },
            { id: 'new', title: 'New', updateTime: '2026-08-05T10:00:00Z' },
          ],
        },
        { studentSubmissions: [] },
      ]);
      const adapter = new GoogleClassroomAdapter(cfg);
      const items = await adapter.getAssignments(tokens, '12345', { since });
      expect(items.map((i) => i.title)).toEqual(['New']);
    });
  });

  describe('getAnnouncements', () => {
    it('derives a short title from the first line of the announcement text', async () => {
      mockFetchQueue([
        {
          announcements: [
            {
              courseId: '12345',
              id: 'ann-1',
              text: 'Class canceled Friday\nBack Monday as normal',
              creationTime: '2026-08-05T10:00:00Z',
              updateTime: '2026-08-05T10:00:00Z',
              alternateLink: 'https://classroom.google.com/c/12345/p/ann-1',
            },
          ],
        },
      ]);
      const adapter = new GoogleClassroomAdapter(cfg);
      const items = await adapter.getAnnouncements(tokens, '12345');
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        externalId: 'ann-1',
        title: 'Class canceled Friday',
        body: 'Class canceled Friday\nBack Monday as normal',
        url: 'https://classroom.google.com/c/12345/p/ann-1',
      });
    });
  });

  describe('getGrades', () => {
    it('surfaces graded submissions with percentage derived from maxPoints', async () => {
      mockFetchQueue([
        {
          studentSubmissions: [
            { courseWorkId: 'cw-1', id: 's1', assignedGrade: 85, updateTime: '2026-08-10T10:00:00Z' },
            { courseWorkId: 'cw-2', id: 's2', state: 'NEW' }, // no assignedGrade → skipped
          ],
        },
        {
          courseWork: [
            { id: 'cw-1', title: 'HW1', maxPoints: 100 },
            { id: 'cw-2', title: 'HW2' },
          ],
        },
      ]);
      const adapter = new GoogleClassroomAdapter(cfg);
      const grades = await adapter.getGrades(tokens, '12345');
      expect(grades).toHaveLength(1);
      expect(grades[0]).toMatchObject({
        externalId: 'sub-s1',
        assignmentExternalId: 'cw-1',
        label: 'HW1',
        score: 85,
        maxScore: 100,
        percentage: 85,
      });
    });
  });

  describe('getFiles', () => {
    it('deduplicates the same drive file referenced from multiple sources', async () => {
      mockFetchQueue([
        // courseWorkMaterials
        {
          courseWorkMaterial: [
            {
              id: 'mat-1',
              title: 'Slides pack',
              updateTime: '2026-08-01T10:00:00Z',
              materials: [
                {
                  driveFile: {
                    driveFile: {
                      id: 'drive-abc',
                      title: 'lecture-1.pdf',
                      alternateLink: 'https://drive.google.com/file/d/drive-abc',
                    },
                  },
                },
              ],
            },
          ],
        },
        // courseWork (same file also attached to an assignment)
        {
          courseWork: [
            {
              id: 'cw-1',
              title: 'HW',
              updateTime: '2026-08-02T10:00:00Z',
              materials: [
                {
                  driveFile: {
                    driveFile: {
                      id: 'drive-abc',
                      title: 'lecture-1.pdf',
                    },
                  },
                },
              ],
            },
          ],
        },
        // announcements
        { announcements: [] },
      ]);
      const adapter = new GoogleClassroomAdapter(cfg);
      const files = await adapter.getFiles(tokens, '12345');
      expect(files).toHaveLength(1);
      expect(files[0]).toMatchObject({
        externalId: 'drive-drive-abc',
        filename: 'lecture-1.pdf',
      });
    });
  });

  describe('getExams + getCalendar', () => {
    it('return empty arrays (Classroom folds quizzes into coursework and has no calendar API)', async () => {
      const adapter = new GoogleClassroomAdapter(cfg);
      expect(await adapter.getExams(tokens, '12345')).toEqual([]);
      expect(await adapter.getCalendar(tokens, '12345')).toEqual([]);
    });
  });

  describe('reliability', () => {
    it('retries on HTTP 429 with backoff, then succeeds', async () => {
      mockFetchQueue([
        { status: 429 },
        { sub: 'u1', name: 'user', email: 'u@x.com' },
      ]);
      const adapter = new GoogleClassroomAdapter(cfg);
      const profile = await adapter.getProfile(tokens);
      expect(profile.remoteUserId).toBe('u1');
    });

    it('throws LmsProviderError retryable=true after exhausting 429 retries', async () => {
      mockFetchQueue([{ status: 429 }, { status: 429 }, { status: 429 }, { status: 429 }]);
      const adapter = new GoogleClassroomAdapter(cfg);
      await expect(adapter.getProfile(tokens)).rejects.toMatchObject({
        name: 'LmsProviderError',
        retryable: true,
      });
    });

    it('surfaces 401 as a non-retryable auth error', async () => {
      mockFetchQueue([{ status: 401, body: { error: { code: 401, message: 'Invalid Credentials' } } }]);
      const adapter = new GoogleClassroomAdapter(cfg);
      await expect(adapter.getProfile(tokens)).rejects.toMatchObject({
        name: 'LmsProviderError',
        status: 401,
        retryable: false,
      });
    });
  });
});
