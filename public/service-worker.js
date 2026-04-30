const CACHE_NAME = 'las-rositas-stock-v2';
const urlsToCache = [
  '/',
  '/index.html',
  '/style.css',
  '/main.js'
];

self.addEventListener('install', event => {
  self.skipWaiting(); // Force new service worker to take over
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        return cache.addAll(urlsToCache);
      })
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim()) // claim clients immediately
  );
});

self.addEventListener('fetch', event => {
  // Solo interceptamos peticiones GET que no sean de la API
  if (event.request.method !== 'GET' || event.request.url.includes('/api/')) {
    return;
  }
  
  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Actualiza el cache si la petición de red fue exitosa
        if(response && response.status === 200 && response.type === 'basic') {
          let responseClone = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      })
      .catch(() => {
        // Si falla la red, busca en el cache (Offline mode)
        return caches.match(event.request);
      })
  );
});
