import { afterEach, describe, expect, it, vi } from 'vitest';
import { MoodleAdapter, appendMoodleToken, stripHtml } from './moodle';

const cfg = {
  portalUrl: 'https://moodle.test.edu',
  redirectUri: 'https://app.local/api/v1/university/oauth/moodle/callback',
  clientId: '',
  clientSecret: '',
};

const tokens = { accessToken: 'ws-token-abc' };

/**
 * Mocks fetch to serve a queue of JSON payloads in order. Each payload can be
 * an object (200 OK), a Response, or a { status, body } pair.
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

describe('MoodleAdapter', () => {
  afterEach(() => vi.restoreAllMocks());

  describe('helpers', () => {
    it('appendMoodleToken appends token as new param when URL has none', () => {
      expect(appendMoodleToken('https://x.edu/pluginfile.php/1/mod/1/file.pdf', 't-1')).toBe(
        'https://x.edu/pluginfile.php/1/mod/1/file.pdf?token=t-1',
      );
    });
    it('appendMoodleToken appends with & when URL already has a query', () => {
      expect(appendMoodleToken('https://x.edu/file.pdf?forcedownload=1', 't-1')).toBe(
        'https://x.edu/file.pdf?forcedownload=1&token=t-1',
      );
    });
    it('appendMoodleToken URL-encodes the token', () => {
      expect(appendMoodleToken('https://x.edu/f.pdf', 'a b/c=')).toBe(
        'https://x.edu/f.pdf?token=a%20b%2Fc%3D',
      );
    });
    it('stripHtml removes tags and decodes common entities', () => {
      expect(stripHtml('<p>Hello&nbsp;<b>World</b> &amp; you</p>')).toBe('Hello World & you');
      expect(stripHtml(undefined)).toBeUndefined();
      expect(stripHtml('')).toBeUndefined();
      expect(stripHtml('<br/>plain')).toBe('plain');
    });
  });

  describe('authenticate', () => {
    it('validates the token by calling core_webservice_get_site_info and returns it unchanged', async () => {
      const spy = mockFetchQueue([{ sitename: 'Test', username: 'u1', userid: 42 }]);
      const adapter = new MoodleAdapter(cfg);
      const result = await adapter.authenticate('the-token');
      expect(result.accessToken).toBe('the-token');
      // Verify the call was against the right URL with the token + function.
      const url = new URL(String(spy.mock.calls[0]![0]));
      expect(url.origin + url.pathname).toBe('https://moodle.test.edu/webservice/rest/server.php');
      expect(url.searchParams.get('wstoken')).toBe('the-token');
      expect(url.searchParams.get('wsfunction')).toBe('core_webservice_get_site_info');
      expect(url.searchParams.get('moodlewsrestformat')).toBe('json');
    });

    it('refresh() is a no-op that returns the same token', async () => {
      const adapter = new MoodleAdapter(cfg);
      const result = await adapter.refresh('the-token');
      expect(result.tokens.accessToken).toBe('the-token');
      expect(result.rotated).toBe(false);
    });

    it('surfaces Moodle-style HTTP-200-with-error-body as LmsProviderError', async () => {
      mockFetchQueue([
        {
          exception: 'moodle_exception',
          errorcode: 'invalidtoken',
          message: 'Invalid token - token not found',
        },
      ]);
      const adapter = new MoodleAdapter(cfg);
      await expect(adapter.authenticate('bad')).rejects.toThrow(/invalidtoken|Invalid token/);
    });
  });

  describe('getProfile', () => {
    it('maps site info to LmsProfile', async () => {
      mockFetchQueue([
        {
          sitename: 'Test U',
          username: 'jsmith',
          fullname: 'Jane Smith',
          userid: 42,
          useridnumber: 'STU-42',
          userpictureurl: 'https://moodle.test.edu/u/42.png',
        },
      ]);
      const adapter = new MoodleAdapter(cfg);
      const profile = await adapter.getProfile(tokens);
      expect(profile).toMatchObject({
        remoteUserId: '42',
        name: 'Jane Smith',
        studentId: 'STU-42',
        avatarUrl: 'https://moodle.test.edu/u/42.png',
      });
    });
  });

  describe('getCourses', () => {
    it('maps Moodle courses to ExternalCourse and computes active correctly', async () => {
      const nowSec = Math.floor(Date.now() / 1000);
      mockFetchQueue([
        { userid: 42 }, // site info
        [
          {
            id: 101,
            fullname: 'Calculus I',
            shortname: 'MATH101',
            visible: 1,
            enddate: nowSec + 86400,
            timemodified: nowSec - 3600,
          },
          {
            id: 102,
            fullname: 'Old Class',
            shortname: 'OLD',
            visible: 1,
            enddate: nowSec - 86400,
          },
          {
            id: 103,
            fullname: 'Hidden',
            shortname: 'HID',
            visible: 0,
            enddate: 0,
          },
        ],
      ]);
      const adapter = new MoodleAdapter(cfg);
      const courses = await adapter.getCourses(tokens);
      expect(courses).toHaveLength(3);
      expect(courses[0]).toMatchObject({ externalId: '101', name: 'Calculus I', code: 'MATH101', active: true });
      expect(courses[1]!.active).toBe(false); // past enddate
      expect(courses[2]!.active).toBe(false); // visible=0
    });
  });

  describe('getAssignments', () => {
    it('maps mod_assign_get_assignments output', async () => {
      mockFetchQueue([
        {
          courses: [
            {
              assignments: [
                {
                  id: 501,
                  cmid: 5001,
                  course: 101,
                  name: 'Problem set 1',
                  intro: '<p>Solve <b>everything</b>.</p>',
                  duedate: 1_800_000_000,
                  grade: 100,
                  timemodified: 1_800_000_000 - 3600,
                },
              ],
            },
          ],
        },
      ]);
      const adapter = new MoodleAdapter(cfg);
      const items = await adapter.getAssignments(tokens, '101');
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        externalId: '501',
        title: 'Problem set 1',
        description: 'Solve everything.',
        maxPoints: 100,
        type: 'assignment',
        url: 'https://moodle.test.edu/mod/assign/view.php?id=5001',
      });
      expect(items[0]!.dueAt).toBeInstanceOf(Date);
    });

    it('respects the incremental `since` filter', async () => {
      const since = new Date(2_000_000_000_000);
      mockFetchQueue([
        {
          courses: [
            {
              assignments: [
                { id: 1, course: 1, name: 'Old', timemodified: 1_500_000_000 },
                { id: 2, course: 1, name: 'New', timemodified: 2_100_000_000 },
              ],
            },
          ],
        },
      ]);
      const adapter = new MoodleAdapter(cfg);
      const items = await adapter.getAssignments(tokens, '1', { since });
      expect(items.map((i) => i.title)).toEqual(['New']);
    });
  });

  describe('getAnnouncements', () => {
    it('finds the News forum then fetches discussions', async () => {
      mockFetchQueue([
        // mod_forum_get_forums_by_courses → returns forums
        [
          { id: 900, course: 101, type: 'general', name: 'General discussion' },
          { id: 901, course: 101, type: 'news', name: 'Announcements' },
        ],
        // mod_forum_get_forum_discussions → discussions in the news forum
        {
          discussions: [
            {
              id: 7000,
              discussion: 7000,
              subject: 'Class canceled',
              message: '<p>No class on Friday.</p>',
              userfullname: 'Prof. Newton',
              created: 1_800_000_000,
              timemodified: 1_800_000_000,
            },
          ],
        },
      ]);
      const adapter = new MoodleAdapter(cfg);
      const items = await adapter.getAnnouncements(tokens, '101');
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        externalId: '7000',
        title: 'Class canceled',
        body: 'No class on Friday.',
        author: 'Prof. Newton',
        url: 'https://moodle.test.edu/mod/forum/discuss.php?d=7000',
      });
    });
  });

  describe('getGrades', () => {
    it('extracts grade items for the current user', async () => {
      mockFetchQueue([
        { userid: 42 }, // site info
        {
          usergrades: [
            {
              gradeitems: [
                {
                  id: 800,
                  itemname: 'Problem set 1',
                  gradeformatted: '85%',
                  gradedatesubmitted: 1_800_000_000,
                  grademin: 0,
                  grademax: 100,
                  graderaw: 85,
                  percentageformatted: '85.00 %',
                },
              ],
            },
          ],
        },
      ]);
      const adapter = new MoodleAdapter(cfg);
      const grades = await adapter.getGrades(tokens, '101');
      expect(grades).toHaveLength(1);
      expect(grades[0]).toMatchObject({
        externalId: '800',
        label: 'Problem set 1',
        score: 85,
        maxScore: 100,
        percentage: 85,
        letterGrade: '85%',
      });
    });
  });

  describe('getFiles', () => {
    it('walks course contents, keeps only file-type entries, and appends token to URLs', async () => {
      mockFetchQueue([
        [
          {
            id: 1,
            name: 'Week 1',
            modules: [
              {
                id: 10,
                name: 'Slides',
                modname: 'resource',
                contents: [
                  {
                    type: 'file',
                    filename: 'lecture1.pdf',
                    filesize: 12345,
                    fileurl: 'https://moodle.test.edu/pluginfile.php/1/mod_resource/content/1/lecture1.pdf',
                    mimetype: 'application/pdf',
                    timemodified: 1_800_000_000,
                  },
                  { type: 'url', filename: 'external' },
                ],
              },
            ],
          },
        ],
      ]);
      const adapter = new MoodleAdapter(cfg);
      const files = await adapter.getFiles(tokens, '101');
      expect(files).toHaveLength(1);
      expect(files[0]).toMatchObject({
        externalId: 'mod-10-lecture1.pdf',
        filename: 'lecture1.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 12345,
      });
      expect(files[0]!.url).toBe(
        'https://moodle.test.edu/pluginfile.php/1/mod_resource/content/1/lecture1.pdf?token=ws-token-abc',
      );
    });
  });

  describe('reliability', () => {
    it('retries on HTTP 429 with backoff, then succeeds', async () => {
      mockFetchQueue([
        { status: 429 },
        { sitename: 'Test', username: 'u1', userid: 42 },
      ]);
      const adapter = new MoodleAdapter(cfg);
      const profile = await adapter.getProfile(tokens);
      expect(profile.remoteUserId).toBe('42');
    });

    it('throws LmsProviderError with retryable=true after exhausting 429 retries', async () => {
      mockFetchQueue([{ status: 429 }, { status: 429 }, { status: 429 }, { status: 429 }]);
      const adapter = new MoodleAdapter(cfg);
      await expect(adapter.getProfile(tokens)).rejects.toMatchObject({
        name: 'LmsProviderError',
        retryable: true,
      });
    });
  });
});
