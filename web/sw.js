/* The web version's service worker: keeps the app's files so it opens
 * offline. The build (vite.config.ts, webServiceWorker) fills in the three
 * placeholders. It never sees the sets: they live in IndexedDB, not in
 * requests.
 *
 * The page itself is network-first (a new version shows on the next open),
 * everything else is cache-first (the file names carry their hash).
 * The cache prefix must not start with "flashcards-": the old site's retired
 * worker (404canvas public/flashcards-sw.js) deletes caches named that way.
 */

const BASE = '__BASE__'; // "/flashcards/"
const VERSION = '__VERSION__';
const FILES = '__FILES__';

const CACHE = `fcweb-${VERSION}`;
const PAGE = BASE.replace(/\/$/, ''); // "/flashcards"
const KEEP = new Set(FILES.map((f) => BASE + f));

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll([PAGE, ...KEEP]);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n.startsWith('fcweb-') && n !== CACHE).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

async function page(request) {
  const cache = await caches.open(CACHE);
  try {
    const fresh = await fetch(request, { cache: 'no-cache' });
    if (fresh.ok && !fresh.redirected) await cache.put(PAGE, fresh.clone());
    return fresh;
  } catch {
    return (await cache.match(PAGE)) ?? Response.error();
  }
}

async function file(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const fresh = await fetch(request);
  if (fresh.ok) await cache.put(request, fresh.clone());
  return fresh;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === 'navigate' && (url.pathname === PAGE || url.pathname === `${BASE}index.html`)) {
    event.respondWith(page(request));
  } else if (KEEP.has(url.pathname) || url.pathname.startsWith(`${BASE}assets/`)) {
    event.respondWith(file(request));
  }
});
