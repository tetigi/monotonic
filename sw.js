const CACHE = 'monotonic-v5';
const FONT_CACHE = 'monotonic-fonts-v1';
const NET_TIMEOUT = 2500; // ms before falling back to cache on slow/flaky networks
const SHELL = [
  './',
  'index.html',
  'app.js',
  'core.js',
  'vendor/toml.js',
  'manifest.webmanifest',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  const keep = [CACHE, FONT_CACHE];
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !keep.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function fetchWithTimeout(req, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return fetch(req, { signal: ctrl.signal }).finally(() => clearTimeout(t));
}

// Network-first: when online, always get the latest shell and refresh the
// cache; when offline/slow, fall back to the cached copy. A navigation is
// keyed to index.html so the app still launches offline.
async function networkFirst(req) {
  const key = req.mode === 'navigate' ? 'index.html' : req;
  try {
    const fresh = await fetchWithTimeout(req, NET_TIMEOUT);
    if (fresh && fresh.ok) (await caches.open(CACHE)).put(key, fresh.clone());
    return fresh;
  } catch {
    const cached = await caches.match(key);
    if (cached) return cached;
    throw new Error('offline and not cached');
  }
}

// Cache-first: for immutable third-party assets (web fonts). Cached on first
// online load so the custom type survives offline.
async function cacheFirst(req, cacheName) {
  const cached = await caches.match(req);
  if (cached) return cached;
  const fresh = await fetch(req);
  if (fresh && (fresh.ok || fresh.type === 'opaque')) (await caches.open(cacheName)).put(req, fresh.clone());
  return fresh;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.host === 'fonts.googleapis.com' || url.host === 'fonts.gstatic.com') {
    e.respondWith(cacheFirst(req, FONT_CACHE));
    return;
  }
  // App shell (navigations + same-origin assets) is network-first. Other
  // cross-origin requests (e.g. a remote plans TOML) are left to the page,
  // which keeps its own copy in localStorage.
  if (req.mode === 'navigate' || url.origin === self.location.origin) {
    e.respondWith(networkFirst(req));
  }
});
