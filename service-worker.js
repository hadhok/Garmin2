/* service-worker.js — migration vers sw.js
   Ce fichier vide tous les caches, se désenregistre, et recharge la page
   pour que le nouveau service worker (sw.js) prenne le relais. */

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => self.registration.unregister())
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then(clients => clients.forEach(c => c.navigate(c.url)))
  );
});
