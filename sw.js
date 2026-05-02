const CACHE_NAME = 'wjp-debt-v4-p5c';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js?v=128-p5c-defer',
  '/manifest.json'
];

self.addEventListener('install', (evt) => {
  // Activate this SW as soon as it's installed
  self.skipWaiting();
  evt.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] caching shell:', CACHE_NAME);
      return cache.addAll(STATIC_ASSETS).catch(function(e){ console.warn('[SW] addAll partial:', e); });
    })
  );
});

self.addEventListener('activate', (evt) => {
  evt.waitUntil(self.clients.claim());
  // Delete all caches with a different name so old versions don't accumulate
  evt.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter(key => key !== CACHE_NAME).map(key => {
        console.log('[SW] dropping old cache:', key);
        return caches.delete(key);
      })
    ))
  );
});

// Fetch strategy:
// - Same-origin GET requests for HTML/CSS/JS/JSON: network-first, fall back to cache, then refresh cache.
// - Cross-origin (Plaid, Chart.js, fonts, etc.): pass through, never cache (avoid storage bloat + stale third-party).
// - Non-GET (POST etc.): pass through, never cache.
self.addEventListener('fetch', (evt) => {
  const req = evt.request;
  const url = new URL(req.url);

  // Skip non-GET, cross-origin, and non-http(s) requests
  if (req.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/.netlify/')) return; // skip Netlify Identity / functions

  evt.respondWith(
    fetch(req).then(fetchRes => {
      // Only cache successful, basic responses
      if (fetchRes && fetchRes.status === 200 && fetchRes.type === 'basic') {
        const clone = fetchRes.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(req, clone)).catch(()=>{});
      }
      return fetchRes;
    }).catch(() => caches.match(req))
  );
});
