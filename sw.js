// Bộ nhớ đệm để app "Xem phim lồng tiếng" mở được cả khi mạng yếu.
// Chỉ lưu giao diện app; lời dịch và giọng đọc luôn lấy từ máy chủ.
const CACHE = 'phim-v1';
const SHELL = ['phim.html', 'phim.webmanifest', 'icons/phim-192.png', 'icons/phim-512.png', 'icons/phim-180.png', 'icons/phim.svg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return; // máy chủ dịch, phông chữ: đi thẳng ra mạng
  // Mạng trước (luôn có bản mới), mất mạng thì dùng bản đã lưu
  e.respondWith(fetch(e.request).then(r => {
    if (r.ok && SHELL.some(s => u.pathname.endsWith('/' + s))) { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
