const CACHE = 'finance-v2';
const FILES = ['./', './index.html', './styles.css', './logic.js', './parsers.js', './xlsx.js', './i18n.js', './app.js', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// Network first (so updates arrive), falling back to the cache after 3 seconds or when offline.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  const key = new URL(req.url).pathname.endsWith('/index.html') || new URL(req.url).search ? new Request(new URL(req.url).pathname) : req;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const net = fetch(req).then((res) => { if (res && res.ok) cache.put(key, res.clone()); return res; });
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000));
    try { return await Promise.race([net, timeout]); }
    catch (err) {
      const hit = (await cache.match(key, { ignoreSearch: true })) || (await cache.match('./index.html'));
      if (hit) return hit;
      return net;
    }
  })());
});
