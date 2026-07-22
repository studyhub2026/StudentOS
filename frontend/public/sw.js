/**
 * StudentOS AI service worker.
 *
 * Strategy by request type:
 *   - Navigations: network-first with an offline fallback, so a student always
 *     gets fresh pages when online but is not left staring at a browser error
 *     when they are not.
 *   - Static build assets: cache-first, since Next fingerprints their names
 *     and a given URL's content never changes.
 *   - API GETs: network-first with a cached fallback, so recently viewed data
 *     remains readable offline.
 *
 * API writes are deliberately never cached or replayed — silently re-sending a
 * mutation later could duplicate an action the student has already redone.
 */

const VERSION = 'v1';
const STATIC_CACHE = `studentos-static-${VERSION}`;
const PAGE_CACHE = `studentos-pages-${VERSION}`;
const API_CACHE = `studentos-api-${VERSION}`;

const OFFLINE_URL = '/offline';

/** Entries older than this are treated as too stale to show. */
const API_MAX_AGE_MS = 24 * 60 * 60 * 1000;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(PAGE_CACHE)
      .then((cache) => cache.addAll([OFFLINE_URL]))
      // Activate immediately rather than waiting for every tab to close.
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => !key.endsWith(VERSION))
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

/** True for Next's immutable, content-hashed build output. */
function isStaticAsset(url) {
  return (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname === '/manifest.webmanifest'
  );
}

function isApiRequest(url) {
  return url.pathname.startsWith('/api/');
}

async function networkFirstPage(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(PAGE_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;

    const offline = await caches.match(OFFLINE_URL);
    return (
      offline ??
      new Response('You are offline.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain' },
      })
    );
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(STATIC_CACHE);
    cache.put(request, response.clone());
  }
  return response;
}

async function networkFirstApi(request) {
  const cache = await caches.open(API_CACHE);

  try {
    const response = await fetch(request);
    if (response.ok) {
      // Stamp the entry so staleness can be judged when it is served back.
      const body = await response.clone().blob();
      const headers = new Headers(response.headers);
      headers.set('x-sw-cached-at', String(Date.now()));
      cache.put(request, new Response(body, { status: response.status, headers }));
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    if (!cached) {
      return new Response(
        JSON.stringify({
          success: false,
          error: { code: 'OFFLINE', message: 'You are offline and this data is not cached.' },
        }),
        { status: 503, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const cachedAt = Number(cached.headers.get('x-sw-cached-at') ?? 0);
    if (cachedAt && Date.now() - cachedAt > API_MAX_AGE_MS) {
      return new Response(
        JSON.stringify({
          success: false,
          error: { code: 'OFFLINE_STALE', message: 'Offline, and the cached copy is too old.' },
        }),
        { status: 503, headers: { 'Content-Type': 'application/json' } },
      );
    }

    return cached;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only GET is safe to serve from cache; everything else must reach the server.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Cross-origin requests (Cloudinary, Google fonts) are left to the browser.
  if (url.origin !== self.location.origin && !isApiRequest(url)) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstPage(request));
    return;
  }

  if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (isApiRequest(url)) {
    event.respondWith(networkFirstApi(request));
  }
});

// --- Push notifications -----------------------------------------------------

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'StudentOS AI', body: event.data.text() };
  }

  event.waitUntil(
    self.registration.showNotification(payload.title ?? 'StudentOS AI', {
      body: payload.body ?? '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: payload.tag ?? 'studentos',
      data: { url: payload.url ?? '/dashboard' },
      // Reminders should persist until acknowledged rather than auto-dismiss.
      requireInteraction: payload.requireInteraction === true,
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data?.url ?? '/dashboard';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // Focus an existing tab rather than opening a duplicate.
      for (const client of clients) {
        if (client.url.includes(target) && 'focus' in client) return client.focus();
      }
      const existing = clients[0];
      if (existing) {
        void existing.focus();
        return existing.navigate(target);
      }
      return self.clients.openWindow(target);
    }),
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
