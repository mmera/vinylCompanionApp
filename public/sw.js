/* Crate service worker.
 *
 * Deliberately conservative. Its only job is to make the app shell load
 * offline and start fast on repeat visits.
 *
 * It never touches cross-origin requests, which means Claude and Spotify
 * traffic — and the credentials in those headers — pass straight through to
 * the network and are never stored. Album art from Spotify's CDN is also left
 * alone; the browser's own HTTP cache handles that well enough.
 *
 * Cache names are versioned; bump CACHE_VERSION to evict everything on the
 * next deploy.
 */

const CACHE_VERSION = 'v1';
const CACHE_NAME = `crate-shell-${CACHE_VERSION}`;

// Resolved from the SW's own location so this works at any base path
// (GitHub Pages serves the app under /vinylCompanionApp/).
const SCOPE_PATH = new URL(self.registration.scope).pathname;
const INDEX_URL = SCOPE_PATH;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll([INDEX_URL]))
      // A failed precache must not block activation — the fetch handler
      // falls back to the network anyway.
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key.startsWith('crate-shell-') && key !== CACHE_NAME).map((key) =>
            caches.delete(key),
          ),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Anything off-origin (api.anthropic.com, api.spotify.com, i.scdn.co,
  // p.scdn.co preview clips) is none of our business.
  if (url.origin !== self.location.origin) return;

  // SPA navigation: try the network so a new deploy is picked up promptly,
  // and fall back to the cached shell when offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(INDEX_URL, copy));
          return response;
        })
        .catch(() => caches.match(INDEX_URL).then((cached) => cached ?? Response.error())),
    );
    return;
  }

  // Static assets are content-hashed by Metro, so a cache hit is always
  // correct. Revalidate in the background to pick up unhashed files.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response.ok && response.type === 'basic') {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached ?? Response.error());

      return cached ?? network;
    }),
  );
});
