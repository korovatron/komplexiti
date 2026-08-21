const CACHE_NAME = 'komplexiti-v1.0.72';
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './main.js',
    './manifest.json',
    './sw.js',
    './images/komplexitiTitle.png',
    './images/icon-192.png',
    './images/icon-512.png',
    './images/icon.svg',
    'https://unpkg.com/mathlive@0.110.0',
    'https://cdnjs.cloudflare.com/ajax/libs/mathjs/11.11.0/math.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/lz-string/1.5.0/lz-string.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/qrious/4.0.2/qrious.min.js'
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
                    if (cacheName !== CACHE_NAME) return caches.delete(cacheName);
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
                    fetchWithTimeout(event.request, 2000)
                        .then((fresh) => {
                            if (fresh.status === 200)
                                caches.open(CACHE_NAME).then((c) => c.put(event.request, fresh.clone()));
                        })
                        .catch(() => {});
                    return cached;
                }
                return fetchWithTimeout(event.request, 2000).catch(async () => {
                    const fallback = await caches.match('./index.html');
                    return fallback || new Response('Offline', { status: 503, statusText: 'Offline' });
                });
            }).catch(async () => {
                const fallback = await caches.match('./index.html');
                return fallback || new Response('Offline', { status: 503, statusText: 'Offline' });
            })
        );
        return;
    }

    event.respondWith(
        caches.match(event.request).then((cached) => {
            if (cached) {
                fetchWithTimeout(event.request, 5000)
                    .then((fresh) => {
                        if (fresh.status === 200)
                            caches.open(CACHE_NAME).then((c) => c.put(event.request, fresh.clone()));
                    })
                    .catch(() => {});
                return cached;
            }
            return fetchWithTimeout(event.request, 5000)
                .then((response) => {
                    if (response.status === 200) {
                        caches.open(CACHE_NAME).then((c) => c.put(event.request, response.clone()));
                    }
                    return response;
                })
                .catch(async () => {
                    if (event.request.destination === 'document') {
                        const fallback = await caches.match('./index.html');
                        if (fallback) return fallback;
                    }
                    const fallback = await caches.match(event.request, { ignoreSearch: true });
                    if (fallback) return fallback;
                    return new Response('', { status: 504, statusText: 'Gateway Timeout' });
                });
        }).catch(async () => {
            if (event.request.destination === 'document') {
                const fallback = await caches.match('./index.html');
                if (fallback) return fallback;
            }
            const fallback = await caches.match(event.request, { ignoreSearch: true });
            if (fallback) return fallback;
            return new Response('', { status: 504, statusText: 'Gateway Timeout' });
        })
    );
});

function fetchWithTimeout(request, timeout) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    return fetch(request, { signal: controller.signal }).finally(() => clearTimeout(id));
}

self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

