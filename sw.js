const CACHE_NAME = 'substracker-v5';
const ASSETS = [
  '/substracker/',
  '/substracker/index.html',
  '/substracker/manifest.json',
  '/substracker/icon-192.png',
  '/substracker/icon-512.png',
];

// これらは常にネットワーク優先で取得（更新が即反映されるように）
const NETWORK_FIRST = /\/(index\.html|manifest\.json|icon-192\.png|icon-512\.png|apple-touch-icon\.png)(\?|$)/;

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

self.addEventListener('fetch', e => {
  // chrome-extension や POST は無視
  if (!e.request.url.startsWith('http') || e.request.method !== 'GET') return;

  // HTML・manifest・アイコンはネットワーク優先：常に最新を取得し、オフライン時のみキャッシュを返す
  const isDoc = e.request.mode === 'navigate' || e.request.destination === 'document';
  if (isDoc || e.request.destination === 'manifest' || NETWORK_FIRST.test(e.request.url)) {
    e.respondWith(
      fetch(e.request).then(res => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        return res;
      }).catch(() =>
        caches.match(e.request).then(c => c || (isDoc ? caches.match('/substracker/index.html') : undefined))
      )
    );
    return;
  }

  // それ以外はキャッシュ優先、失敗時はネットワーク
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
    })
  );
});
