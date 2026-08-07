import { afterEach, describe, expect, it, vi } from 'vitest';
import { CanvasAdapter } from './canvas';

const cfg = {
  portalUrl: 'https://canvas.test.edu',
  redirectUri: 'https://app.local/api/v1/university/oauth/canvas/callback',
  clientId: 'client_123',
  clientSecret: 'secret_456',
};

describe('CanvasAdapter', () => {
  afterEach(() => vi.restoreAllMocks());

  it('builds the authorize URL with the required OAuth params', () => {
    const adapter = new CanvasAdapter(cfg);
    const url = new URL(adapter.getAuthorizeUrl('state-abc'));
    expect(url.origin + url.pathname).toBe('https://canvas.test.edu/login/oauth2/auth');
    expect(url.searchParams.get('client_id')).toBe('client_123');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('redirect_uri')).toBe(cfg.redirectUri);
    expect(url.searchParams.get('state')).toBe('state-abc');
    // Scopes must be present so the token grants API access.
    expect(url.searchParams.get('scope')).toContain('url:GET|/api/v1/courses');
  });

  it('exchanges an authorization code for tokens', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: 'access-1',
            refresh_token: 'refresh-1',
            expires_in: 3600,
          }),
          { status: 200 },
        ),
      );
    const adapter = new CanvasAdapter(cfg);
    const tokens = await adapter.authenticate('the-code');
    expect(tokens.accessToken).toBe('access-1');
    expect(tokens.refreshToken).toBe('refresh-1');
    expect(tokens.expiresAt).toBeInstanceOf(Date);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('https://canvas.test.edu/login/oauth2/token');
    const body = String((init as RequestInit).body);
    expect(body).toContain('grant_type=authorization_code');
    expect(body).toContain('code=the-code');
  });

  it('refreshes tokens and reports rotation', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ access_token: 'access-2', refresh_token: 'refresh-2', expires_in: 3600 }),
        { status: 200 },
      ),
    );
    const adapter = new CanvasAdapter(cfg);
    const { tokens, rotated } = await adapter.refresh('refresh-1');
    expect(tokens.accessToken).toBe('access-2');
    expect(tokens.refreshToken).toBe('refresh-2');
    expect(rotated).toBe(true);
  });

  it('reports rotated=false when the provider re-uses the refresh token', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ access_token: 'access-3', refresh_token: 'refresh-1', expires_in: 3600 }),
        { status: 200 },
      ),
    );
    const adapter = new CanvasAdapter(cfg);
    const { rotated } = await adapter.refresh('refresh-1');
    expect(rotated).toBe(false);
  });

  it('maps a Canvas course payload into ExternalCourse', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          {
            id: 101,
            name: 'Physics 201',
            course_code: 'PHY201',
            workflow_state: 'available',
            teachers: [{ display_name: 'Dr. Curie' }],
            term: { name: 'Spring 2026' },
            updated_at: '2026-02-01T10:00:00Z',
          },
        ]),
        { status: 200, headers: {} },
      ),
    );
    const adapter = new CanvasAdapter(cfg);
    const courses = await adapter.getCourses({ accessToken: 'a' });
    expect(courses).toHaveLength(1);
    expect(courses[0]).toMatchObject({
      externalId: '101',
      name: 'Physics 201',
      code: 'PHY201',
      instructor: 'Dr. Curie',
      term: 'Spring 2026',
      active: true,
    });
    expect(courses[0]!.remoteUpdatedAt).toBeInstanceOf(Date);
  });

  it('follows Link-header pagination', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ id: 1, name: 'C1' }]), {
          status: 200,
          headers: {
            link: '<https://canvas.test.edu/api/v1/courses?page=2>; rel="next"',
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ id: 2, name: 'C2' }]), { status: 200 }),
      );
    const adapter = new CanvasAdapter(cfg);
    const courses = await adapter.getCourses({ accessToken: 'a' });
    expect(courses).toHaveLength(2);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('backs off and retries on 429', async () => {
    let calls = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      calls++;
      if (calls < 2) return new Response('', { status: 429 });
      return new Response(JSON.stringify([]), { status: 200 });
    });
    const adapter = new CanvasAdapter(cfg);
    const courses = await adapter.getCourses({ accessToken: 'a' });
    expect(courses).toEqual([]);
    expect(calls).toBe(2);
  });
});
