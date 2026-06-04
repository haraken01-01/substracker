const CACHE_NAME = 'substracker-v1';
const ASSETS = [
  '/substracker/',
  '/substracker/index.html',
  '/substracker/manifest.json',
  '/substracker/icon-192.png',
  '/substracker/icon-512.png',
];

// インストール：アセットをキャッシュ
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

// アクティベート：古いキャッシュを削除
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// フェッチ：キャッシュ優先、失敗時はネットワーク
self.addEventListener('fetch', e => {
  // chrome-extension や POST は無視
  if (!e.request.url.startsWith('http') || e.request.method !== 'GET') return;

  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        // 成功したレスポンスをキャッシュに追加
        if (res && res.status === 200 && res.type === 'basic') {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        }
        return res;
      });
    }).catch(() => {
      // オフライン時はindex.htmlを返す
      if (e.request.destination === 'document') {
        return caches.match('/substracker/index.html');
      }
    })
  );
});
