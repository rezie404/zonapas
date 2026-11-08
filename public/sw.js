// Service worker minimal ZonaPas: tidak menyimpan cache apa pun.
// Semua permintaan diteruskan ke jaringan supaya konten tidak pernah basi.
// Keberadaannya hanya memenuhi syarat installability (PWA/TWA).
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});
