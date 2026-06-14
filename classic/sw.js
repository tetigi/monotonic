// Distinct cache namespace from the main app: CacheStorage is shared per-origin
// and this SW lives under /classic/, so it must never touch the main app's caches.
const CACHE = 'monotonic-classic-v1';
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
  e.waitUntil(
    caches.keys()
      // Only ever prune our own old classic caches; leave the main app's alone.
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('monotonic-classic') && k !== CACHE).map((k) => caches.delete(k))))
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

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // App shell (navigations + same-origin assets) is network-first. Cross-origin
  // requests (e.g. a remote plans TOML) are left to the page, which keeps its
  // own copy in localStorage.
  if (req.mode === 'navigate' || url.origin === self.location.origin) {
    e.respondWith(networkFirst(req));
  }
});
