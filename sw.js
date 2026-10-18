// Override Scout service worker: app shell offline, season data stale-while-revalidate.
// BUILD_ID is replaced on every deploy by the GitHub Action, which makes phones pick up updates.
const BUILD_ID = 'dev';
const SHELL_CACHE = 'os-shell-' + BUILD_ID;
const DATA_CACHE = 'os-data';
const CDN_CACHE = 'os-cdn-v1';

const SHELL = [
  './', 'index.html', 'config.js', 'manifest.webmanifest', 'css/app.css',
  'js/main.js',
  'js/lib/html.js', 'js/lib/icons.js', 'js/lib/util.js', 'js/lib/db.js', 'js/lib/state.js', 'js/lib/router.js',
  'js/lib/api.js', 'js/lib/data.js', 'js/lib/stats.js', 'js/lib/game.js', 'js/lib/share.js', 'js/lib/sync.js', 'js/lib/sanitize.js',
  'js/components/ui.js', 'js/components/charts.js',
  'js/views/home.js', 'js/views/explore.js', 'js/views/team.js', 'js/views/event.js', 'js/views/match.js', 'js/views/compare.js',
  'js/views/scout.js', 'js/views/practice.js', 'js/views/tools.js', 'js/views/qa.js', 'js/views/me.js', 'js/views/report.js',
  'assets/logo-full-dark.png', 'assets/logo-full-light.png', 'assets/mark-dark.png', 'assets/mark-light.png',
  'assets/icon-192.png', 'assets/icon-512.png', 'assets/favicon-32.png', 'assets/apple-touch-icon.png'
];
const CDN = [
  'https://cdn.jsdelivr.net/npm/preact@10.24.3/dist/preact.module.js',
  'https://cdn.jsdelivr.net/npm/preact@10.24.3/hooks/dist/hooks.module.js',
  'https://cdn.jsdelivr.net/npm/htm@3.1.1/dist/htm.module.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL_CACHE);
    await shell.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })));
    const cdn = await caches.open(CDN_CACHE);
    await Promise.allSettled(CDN.map((u) => cdn.add(u)));
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('os-shell-') && k !== SHELL_CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

async function staleWhileRevalidate(cacheName, request) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request, { ignoreSearch: false });
  const network = fetch(request).then((res) => {
    if (res && res.ok) cache.put(request, res.clone());
    return res;
  }).catch(() => null);
  return cached || (await network) || new Response('null', { status: 504, headers: { 'Content-Type': 'application/json' } });
}

async function cacheFirst(cacheName, request) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const res = await fetch(request);
  if (res && (res.ok || res.type === 'opaque')) cache.put(request, res.clone());
  return res;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Never intercept the live VEX API or the optional team server — the app caches those itself.
  if (url.hostname === 'events.vex.com' || url.hostname.endsWith('workers.dev')) return;

  if (url.origin === self.location.origin) {
    if (req.mode === 'navigate') {
      event.respondWith(fetch(req).catch(async () => (await caches.match('index.html')) || (await caches.match('./'))));
      return;
    }
    if (url.pathname.includes('/data/')) {
      event.respondWith(staleWhileRevalidate(DATA_CACHE, req));
      return;
    }
    event.respondWith(caches.match(req, { ignoreSearch: true }).then((c) => c || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(SHELL_CACHE).then((cache) => cache.put(req, copy)); }
      return res;
    })));
    return;
  }

  if (/(cdn\.jsdelivr\.net|fonts\.googleapis\.com|fonts\.gstatic\.com|youtube-nocookie\.com\/vi)/.test(url.hostname)) {
    event.respondWith(cacheFirst(CDN_CACHE, req));
  }
});
