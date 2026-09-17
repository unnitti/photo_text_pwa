const CACHE = 'photo-text-pwa-v8';
const ASSETS = ['./', './index.html', './style.css?v=0.8', './app.js?v=0.8', './manifest.json?v=0.8', './icon.svg'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
// Network first means a changed file is picked up whenever a connection is available;
// the cache is only the offline fallback.
self.addEventListener('fetch', event => { if (event.request.method !== 'GET') return; event.respondWith(fetch(event.request).then(response => { const copy = response.clone(); caches.open(CACHE).then(cache => cache.put(event.request, copy)); return response; }).catch(() => caches.match(event.request))); });
