self.addEventListener('install', evento => {
    evento.waitUntil(
        caches.open('trace-min-v1').then(cache => {
            return cache.addAll(['/']);
        })
    );
});

self.addEventListener('fetch', evento => {
    evento.respondWith(
        caches.match(evento.request).then(respuesta => {
            return respuesta || fetch(evento.request);
        })
    );
});
