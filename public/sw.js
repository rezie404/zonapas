// Service worker ZonaPas.
// - Konten berita TIDAK pernah di-cache: semua permintaan diteruskan ke
//   jaringan supaya konten tidak pernah basi (kecuali halaman offline).
// - Satu-satunya yang di-cache adalah halaman /offline/ (satu berkas HTML
//   mandiri tanpa CSS/font/gambar luar), supaya saat koneksi putus,
//   navigasi menampilkan penjelasan, bukan halaman gagal peramban.
// - Keberadaan service worker juga memenuhi syarat installability (PWA/TWA).
const NAMA_CACHE = 'zonapas-offline-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(NAMA_CACHE).then((cache) => cache.add('/offline/')).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((kunci) => Promise.all(kunci.filter((k) => k !== NAMA_CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  // Navigasi halaman: coba jaringan dulu; bila gagal (offline), tampilkan
  // halaman offline dari cache. Permintaan lain (gambar, API, aset):
  // teruskan ke jaringan seperti semula.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      // Bila cache /offline/ kosong, jangan respondWith(undefined) —
      // kembalikan halaman HTML sederhana (K21).
      fetch(event.request).catch(() =>
        caches.match('/offline/').then((res) => res || new Response(
          '<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>ZonaPas — Offline</title></head><body style="font-family:sans-serif;max-width:560px;margin:40px auto;padding:0 16px"><h1>Anda sedang offline</h1><p>Periksa koneksi internet Anda lalu muat ulang halaman ini.</p></body></html>',
          { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        ))
      )
    );
    return;
  }
  event.respondWith(fetch(event.request));
});
