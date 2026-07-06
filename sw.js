const CACHE = 'garmin-v11';
const ASSETS = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/constants.js',
  '/js/sanit.js',
  '/js/app.js',
  '/js/dashboard.js',
  '/js/activities.js',
  '/js/health.js',
  '/js/profile.js',
  '/js/running.js',
  '/js/xplor.js',
  '/js/detail_charts.js',
  '/js/poc.js',
  '/js/renpho.js',
  '/js/help.js',
  '/js/runalyze.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/manifest.json',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = e.request.url;
  if (e.request.method !== 'GET') return;
  if (url.includes('/api/') || url.includes('coach.json')) return;

  const isOwnAsset = url.includes('/js/') || url.includes('/css/') || url.endsWith('/index.html');

  if (isOwnAsset) {
    /* Stale-while-revalidate : sert le cache immédiatement,
       mais rafraîchit en arrière-plan → les déploiements sont
       visibles au rechargement suivant sans bump de version. */
    e.respondWith(
      caches.open(CACHE).then(cache =>
        cache.match(e.request).then(cached => {
          const network = fetch(e.request).then(res => {
            if (res.ok) cache.put(e.request, res.clone());
            return res;
          }).catch(() => cached);
          return cached || network;
        })
      )
    );
    return;
  }

  /* Autres ressources : cache-first (CDN, icônes, navigation) */
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (url.includes('cdn.jsdelivr.net') || url.includes('fonts.gstatic.com') || url.includes('fonts.googleapis.com')) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => {
        /* Hors-ligne : fallback index.html uniquement pour les navigations */
        if (e.request.mode === 'navigate') return caches.match('/index.html');
        return Response.error();
      });
    })
  );
});
