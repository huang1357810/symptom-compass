/* 明辨康途 · Service Worker
 * 策略：应用外壳缓存优先，API 请求永不缓存，离线时回退到缓存的首页。
 */
const CACHE = 'symptom-checker-v1';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // 分诊 API 必须走网络，不能缓存，否则拿不到最新结果
  if (url.pathname.indexOf('/api/') >= 0) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response && response.status === 200 && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      }).catch(() => {
        // 离线且未命中缓存：导航请求回退到首页
        if (request.mode === 'navigate') return caches.match('./index.html');
        return new Response('离线且无缓存', { status: 503, statusText: 'Offline' });
      });
    })
  );
});
