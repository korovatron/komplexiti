const CACHE_NAME = 'komplexiti-v1.0.17';
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './main.js',
    './manifest.json',
    './sw.js'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(ASSETS_TO_CACHE))
            .then(() => self.skipWaiting())
            .catch((error) => { console.error('Service worker cache failed:', error); throw error; })
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;

    if (event.request.mode === 'navigate') {
        event.respondWith(
            caches.match(event.request).then((cached) => {
                if (cached) {
                    fetch(event.request).then((fresh) => {
                        if (fresh && fresh.status === 200) {
                            caches.open(CACHE_NAME).then((c) => c.put(event.request, fresh));
                        }
                    }).catch(() => {});
                    return cached;
                }
                return fetch(event.request).catch(async () => {
                    const fallback = await caches.match('./index.html');
                    return fallback || new Response('Offline', { status: 503, statusText: 'Offline' });
                });
            })
        );
        return;
    }

    event.respondWith(
        caches.match(event.request).then((cached) => {
            if (cached) {
                fetch(event.request).then((fresh) => {
                    if (fresh && fresh.status === 200) {
                        caches.open(CACHE_NAME).then((c) => c.put(event.request, fresh.clone()));
                    }
                }).catch(() => {});
                return cached;
            }
            return fetch(event.request).then((response) => {
                if (response.status === 200) {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then((c) => c.put(event.request, clone));
                }
                return response;
            }).catch(async () => {
                if (event.request.destination === 'document') {
                    const fallback = await caches.match('./index.html');
                    if (fallback) return fallback;
                }
                return new Response('', { status: 504, statusText: 'Gateway Timeout' });
            });
        })
    );
});
