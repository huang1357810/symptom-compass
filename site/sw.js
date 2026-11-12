/* 明辨康途 · Service Worker
 * 策略：
 *   - 页面导航：网络优先（保证更新能生效），离线时回退缓存
 *   - 静态资源：缓存优先（图标、manifest 这类不常变的）
 *   - /api/ 请求：永不缓存
 */
const CACHE = 'mingbian-kangtu-v3';
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

  /* 页面导航：网络优先。这样每次发版刷新一次就能拿到新版，
     断网时才用缓存兜底（离线可用的承诺仍然成立）。 */
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put('./index.html', copy));
          }
          return response;
        })
        .catch(() => caches.match('./index.html').then((hit) => hit || caches.match('./')))
    );
    return;
  }

  /* 静态资源：缓存优先，未命中再取网络并写入缓存 */
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response && response.status === 200 && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      }).catch(() => new Response('离线且无缓存', { status: 503, statusText: 'Offline' }));
    })
  );
});
