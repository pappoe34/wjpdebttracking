const CACHE_NAME = 'wjp-debt-v3'; // Updated to v3 — forces full cache clear for credit import feature

const ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/manifest.json'
];

self.addEventListener('install', (evt) => {
  // Force new service worker to install immediately
  self.skipWaiting();
  evt.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('Caching shell assets');
      return cache.addAll(ASSETS);
    })
  );
});

self.addEventListener('activate', (evt) => {
  // Take control immediately
  evt.waitUntil(clients.claim());
  evt.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(keys
        .filter(key => key !== CACHE_NAME)
        .map(key => caches.delete(key))
      );
    })
  );
});

// Network-first strategy for rapid development
self.addEventListener('fetch', (evt) => {
  evt.respondWith(
    fetch(evt.request).then(fetchRes => {
      return caches.open(CACHE_NAME).then(cache => {
        cache.put(evt.request.url, fetchRes.clone());
        return fetchRes;
      });
    }).catch(() => caches.match(evt.request))
  );
});
