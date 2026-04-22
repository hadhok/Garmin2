const CACHE = 'garmin-v1';
const ASSETS = [
  '/Garmin2/',
  '/Garmin2/index.html',
  '/Garmin2/css/style.css',
  '/Garmin2/js/app.js',
  '/Garmin2/js/dashboard.js',
  '/Garmin2/js/activities.js',
  '/Garmin2/js/health.js',
  '/Garmin2/js/profile.js',
  '/Garmin2/icons/icon-192.png',
  '/Garmin2/icons/icon-512.png'
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
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request).catch(() => caches.match('/Garmin2/index.html')))
  );
});
