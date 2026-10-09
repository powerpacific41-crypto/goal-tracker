// Goal Tracker service worker.
// Pages, scripts and styles open instantly from the saved copy and refresh in the background (new code shows from the next open).
// js/config.js is always fetched fresh, so a changed API address applies at once.
// API calls (Apps Script) and anything from other sites are never touched, so data is always live.
const CACHE = 'gt-shell-v3';
const SHELL = ['./', 'index.html', 'css/styles.css', 'css/game.css', 'css/plan.css', 'css/mobile.css',
  'js/config.js', 'js/api.js', 'js/camera.js', 'js/app.js', 'js/game.js', 'js/plan.js', 'js/notify.js',
  'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  const fresh = () => fetch(req).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  });
  if (url.pathname.endsWith('/js/config.js')) {
    e.respondWith(fresh().catch(() => caches.match(req)));
    return;
  }
  e.respondWith(caches.match(req).then((hit) => {
    if (hit) { fresh().catch(() => {}); return hit; }
    return fresh().catch(() => (req.mode === 'navigate' ? caches.match('index.html') : Response.error()));
  }));
});
