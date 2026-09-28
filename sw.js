const CACHE = 'photo-text-cache-v01';

const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) =>
        Promise.all(
          names
            .filter((n) => n !== CACHE)
            .map((n) => caches.delete(n))
        )
      )
      .then(() => self.clients.claim())
  );
});

// 캐시가 있으면 즉시 사용하고,
// 온라인이면 백그라운드에서 최신 파일을 받아 캐시를 갱신.
// 네트워크가 없으면 기존 캐시로 계속 작동.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cached) => {

      const networkFetch = fetch(event.request)
        .then((response) => {

          if (response && response.ok) {
            const copy = response.clone();

            caches.open(CACHE).then((cache) => {
              cache.put(event.request, copy);
            });
          }

          return response;
        })
        .catch(() => cached);

      return cached || networkFetch;

    })
  );
});
