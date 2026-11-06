/**
 * Pengujian scripts/kirim-notifikasi.mjs — dijalankan dengan:
 *   node --test scripts/kirim-notifikasi.test.mjs
 * Tanpa dependensi eksternal (node:test + node:assert bawaan).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emailArtikelBaru, kirimSatuArtikel, main } from './kirim-notifikasi.mjs';

// ---------------------------------------------------------------------------
// Template email artikel baru
// ---------------------------------------------------------------------------

test('emailArtikelBaru: subjek judul apa adanya, isi lolos escape HTML', () => {
  const pesan = emailArtikelBaru({
    title: 'Judul <b>Berita</b> & "Kutip"',
    summary: 'Ringkasan dengan <script>alert(1)</script> & simbol.',
    image: '/images/cover-uji.jpg',
    slug: 'artikel-uji',
    token: 'a'.repeat(64),
  });
  // Subjek = judul apa adanya (teks polos, tanpa awalan).
  assert.equal(pesan.subject, 'Judul <b>Berita</b> & "Kutip"');
  // HTML di-escape: tidak ada tag mentah dari judul/ringkasan.
  assert.doesNotMatch(pesan.html, /<script>/);
  assert.match(pesan.html, /Judul &lt;b&gt;Berita&lt;\/b&gt; &amp; &quot;Kutip&quot;/);
  assert.match(pesan.html, /Ringkasan dengan &lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; simbol\./);
  // Judul + tombol menaut ke URL artikel.
  assert.match(pesan.html, /href="https:\/\/zonapas\.web\.id\/berita\/artikel-uji\/"/);
  assert.match(pesan.html, /Baca selengkapnya &rarr;/);
  // Gambar jadi URL absolut.
  assert.match(pesan.html, /<img src="https:\/\/zonapas\.web\.id\/images\/cover-uji\.jpg"/);
  // Tautan berhenti memuat token penerima.
  assert.match(pesan.html, new RegExp(`/redaksi/api/langganan/berhenti\\?token=${'a'.repeat(64)}`));
  // Versi teks polos memuat ringkasan + URL + tautan berhenti.
  assert.match(pesan.text, /Baca selengkapnya: https:\/\/zonapas\.web\.id\/berita\/artikel-uji\//);
  assert.match(pesan.text, /Berhenti berlangganan: https:\/\/zonapas\.web\.id\/redaksi\/api\/langganan\/berhenti\?token=/);
});

test('emailArtikelBaru: tanpa gambar -> tanpa <img>; tanpa ringkasan tetap jalan', () => {
  const pesan = emailArtikelBaru({ title: 'T', summary: '', image: '', slug: 't', token: 'b'.repeat(64) });
  assert.doesNotMatch(pesan.html, /<img/);
  assert.match(pesan.html, /<h1[^>]*><a href="https:\/\/zonapas\.web\.id\/berita\/t\/"[^>]*>T<\/a><\/h1>/);
});

// ---------------------------------------------------------------------------
// kirimSatuArtikel (fetch di-mock)
// ---------------------------------------------------------------------------

function mockResend(perilaku) {
  const calls = [];
  const fetchFn = async (url, init = {}) => {
    calls.push({ url, method: init.method, body: JSON.parse(init.body || '{}') });
    const status = typeof perilaku === 'function' ? perilaku(calls.length, calls[calls.length - 1]) : perilaku;
    return { ok: status >= 200 && status < 300, status, json: async () => ({ id: 're_mock' }) };
  };
  return { fetchFn, calls };
}

const ARTIKEL = { title: 'Artikel Uji', summary: 'Ringkasan uji.', image: '', slug: 'artikel-uji' };
const TIGA = [
  { email: 'satu@example.com', token: '1'.repeat(64) },
  { email: 'dua@example.com', token: '2'.repeat(64) },
  { email: 'tiga@example.com', token: '3'.repeat(64) },
];

test('kirimSatuArtikel: semua berhasil', async () => {
  const { fetchFn, calls } = mockResend(201);
  const logs = [];
  const origLog = console.log;
  console.log = (...a) => logs.push(a.join(' '));
  let hasil;
  try {
    hasil = await kirimSatuArtikel({ artikel: ARTIKEL, pelanggan: TIGA, resendApiKey: 're_uji', fetchFn, jedaMs: 0 });
  } finally { console.log = origLog; }
  assert.deepEqual(hasil, { terkirim: 3, gagal: 0, batasHarian: false, belumTerkirim: 0 });
  assert.equal(calls.length, 3);
  assert.equal(calls[0].body.to[0], 'satu@example.com');
  assert.equal(calls[1].body.to[0], 'dua@example.com');
  assert.equal(calls[0].body.subject, 'Artikel Uji');
  // Tautan berhenti berbeda per penerima (token masing-masing).
  assert.match(calls[0].body.html, /token=1{64}/);
  assert.match(calls[2].body.html, /token=3{64}/);
});

test('kirimSatuArtikel: 429 pada penerima ke-2 -> berhenti, belum terkirim tercatat', async () => {
  const { fetchFn, calls } = mockResend((n) => (n === 2 ? 429 : 201));
  const logs = [];
  const origLog = console.log;
  console.log = (...a) => logs.push(a.join(' '));
  let hasil;
  try {
    hasil = await kirimSatuArtikel({ artikel: ARTIKEL, pelanggan: TIGA, resendApiKey: 're_uji', fetchFn, jedaMs: 0 });
  } finally { console.log = origLog; }
  assert.equal(hasil.terkirim, 1);
  assert.equal(hasil.gagal, 0);
  assert.equal(hasil.batasHarian, true);
  assert.equal(hasil.belumTerkirim, 2);
  assert.equal(calls.length, 2, 'berhenti setelah 429, penerima ke-3 tidak dikirimi');
  assert.match(logs.join('\n'), /Batas harian Resend tercapai — 2 pelanggan belum terkirim/);
});

test('kirimSatuArtikel: satu penerima gagal (400) -> penerima lain tetap terkirim', async () => {
  const { fetchFn, calls } = mockResend((n) => (n === 2 ? 400 : 201));
  const logs = [];
  const origLog = console.log;
  console.log = (...a) => logs.push(a.join(' '));
  let hasil;
  try {
    hasil = await kirimSatuArtikel({ artikel: ARTIKEL, pelanggan: TIGA, resendApiKey: 're_uji', fetchFn, jedaMs: 0 });
  } finally { console.log = origLog; }
  assert.deepEqual(hasil, { terkirim: 2, gagal: 1, batasHarian: false, belumTerkirim: 0 });
  assert.equal(calls.length, 3);
  assert.match(logs.join('\n'), /Gagal mengirim ke dua@example.com \(Resend 400\)/);
});

test('kirimSatuArtikel: daftar kosong -> tidak ada panggilan', async () => {
  const { fetchFn, calls } = mockResend(201);
  const hasil = await kirimSatuArtikel({ artikel: ARTIKEL, pelanggan: [], resendApiKey: 're_uji', fetchFn, jedaMs: 0 });
  assert.deepEqual(hasil, { terkirim: 0, gagal: 0, batasHarian: false, belumTerkirim: 0 });
  assert.equal(calls.length, 0);
});

// ---------------------------------------------------------------------------
// main() end-to-end (fetch global di-mock, repo tiruan di /tmp)
// ---------------------------------------------------------------------------

function buatRepoTiruan() {
  const dir = mkdtempSync(join(tmpdir(), 'kirim-notifikasi-test-'));
  const berita = join(dir, 'src', 'content', 'berita');
  mkdirSync(berita, { recursive: true });
  mkdirSync(join(dir, '.github'), { recursive: true });
  writeFileSync(join(berita, 'artikel-baru.md'),
    '---\ntitle: "Artikel Baru"\nsummary: "Ringkasan baru."\ncategory: Sinergi\ntags: [t1]\nauthor: Rezie\npublishDate: 2026-11-06\nimage: "/images/cover-baru.jpg"\nimageCaption: "Dok."\nfeatured: false\nbreaking: false\nsource: "zonapas"\n---\n\nParagraf baru.\n');
  return dir;
}

function tulisNotify(dir, isi) {
  writeFileSync(join(dir, '.github', 'notify-created.json'), JSON.stringify(isi, null, 2));
}

async function jalankanMain(dir, { pelanggan = TIGA.slice(0, 2), daftarStatus = 200, resendStatus = 201, env = {} } = {}) {
  const calls = { daftar: [], resend: [] };
  const fetchLama = globalThis.fetch;
  const envLama = { RESEND_API_KEY: process.env.RESEND_API_KEY, LANGGANAN_SYNC_TOKEN: process.env.LANGGANAN_SYNC_TOKEN };
  process.env.RESEND_API_KEY = env.RESEND_API_KEY !== undefined ? env.RESEND_API_KEY : 're_uji';
  process.env.LANGGANAN_SYNC_TOKEN = env.LANGGANAN_SYNC_TOKEN !== undefined ? env.LANGGANAN_SYNC_TOKEN : 'token-uji';
  globalThis.fetch = async (url, init = {}) => {
    url = String(url);
    if (url.includes('/redaksi/api/langganan/daftar')) {
      calls.daftar.push({ url, auth: (init.headers || {}).Authorization });
      if (daftarStatus !== 200) return { ok: false, status: daftarStatus, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ ok: true, pelanggan }) };
    }
    if (url.startsWith('https://api.resend.com/emails')) {
      calls.resend.push({ url, body: JSON.parse(init.body || '{}') });
      return { ok: resendStatus >= 200 && resendStatus < 300, status: resendStatus, json: async () => ({ id: 're_mock' }) };
    }
    throw new Error('fetch tidak dikenal: ' + url);
  };
  const logs = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...a) => logs.push(a.join(' '));
  console.error = (...a) => logs.push(a.join(' '));
  let code;
  try {
    code = await main(['--root', dir]);
  } finally {
    console.log = origLog;
    console.error = origErr;
    globalThis.fetch = fetchLama;
    if (envLama.RESEND_API_KEY === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = envLama.RESEND_API_KEY;
    if (envLama.LANGGANAN_SYNC_TOKEN === undefined) delete process.env.LANGGANAN_SYNC_TOKEN; else process.env.LANGGANAN_SYNC_TOKEN = envLama.LANGGANAN_SYNC_TOKEN;
  }
  return { code, calls, logs: logs.join('\n') };
}

test('main(): sukses end-to-end -> exit 0, satu email per pelanggan', async () => {
  const dir = buatRepoTiruan();
  tulisNotify(dir, [{ path: 'src/content/berita/artikel-baru.md' }]);
  const { code, calls, logs } = await jalankanMain(dir);
  assert.equal(code, 0);
  assert.equal(calls.daftar.length, 1);
  assert.equal(calls.daftar[0].auth, 'Bearer token-uji');
  assert.equal(calls.resend.length, 2);
  assert.equal(calls.resend[0].body.subject, 'Artikel Baru');
  assert.match(logs, /Selesai: 2 terkirim, 0 gagal/);
});

test('main(): daftar kosong -> exit 0 tanpa kirim', async () => {
  const dir = buatRepoTiruan();
  tulisNotify(dir, [{ path: 'src/content/berita/artikel-baru.md' }]);
  const { code, calls, logs } = await jalankanMain(dir, { pelanggan: [] });
  assert.equal(code, 0);
  assert.equal(calls.resend.length, 0);
  assert.match(logs, /tidak ada pelanggan aktif/);
});

test('main(): file JSON tidak ada -> exit 0; JSON kosong -> exit 0', async () => {
  const dir = buatRepoTiruan();
  let hasil = await jalankanMain(dir);
  assert.equal(hasil.code, 0);
  assert.match(hasil.logs, /tidak ada artikel baru/);
  assert.equal(hasil.calls.resend.length, 0);
  tulisNotify(dir, []);
  hasil = await jalankanMain(dir);
  assert.equal(hasil.code, 0);
  assert.equal(hasil.calls.resend.length, 0);
  assert.match(hasil.logs, /tidak ada artikel baru/);
});

test('main(): JSON rusak -> exit 1 (kesalahan pemakaian)', async () => {
  const dir = buatRepoTiruan();
  writeFileSync(join(dir, '.github', 'notify-created.json'), '{bukan json');
  const { code, calls } = await jalankanMain(dir);
  assert.equal(code, 1);
  assert.equal(calls.resend.length, 0);
});

test('main(): 429 dari Resend -> exit 0, berhenti dengan tenang', async () => {
  const dir = buatRepoTiruan();
  tulisNotify(dir, [{ path: 'src/content/berita/artikel-baru.md' }]);
  const { code, calls, logs } = await jalankanMain(dir, { resendStatus: 429 });
  assert.equal(code, 0);
  assert.equal(calls.resend.length, 1, 'berhenti setelah 429 pertama');
  assert.match(logs, /Batas harian Resend tercapai/);
  assert.match(logs, /berhenti karena batas harian/);
});

test('main(): daftar endpoint 401 -> exit 0 tanpa kirim', async () => {
  const dir = buatRepoTiruan();
  tulisNotify(dir, [{ path: 'src/content/berita/artikel-baru.md' }]);
  const { code, calls, logs } = await jalankanMain(dir, { daftarStatus: 401 });
  assert.equal(code, 0);
  assert.equal(calls.resend.length, 0);
  assert.match(logs, /Daftar pelanggan tidak bisa diambil \(HTTP 401\)/);
});

test('main(): secret belum dipasang -> exit 0 (dilewati)', async () => {
  const dir = buatRepoTiruan();
  tulisNotify(dir, [{ path: 'src/content/berita/artikel-baru.md' }]);
  const tanpaResend = await jalankanMain(dir, { env: { RESEND_API_KEY: '', LANGGANAN_SYNC_TOKEN: 'token-uji' } });
  assert.equal(tanpaResend.code, 0);
  assert.equal(tanpaResend.calls.resend.length, 0);
  assert.match(tanpaResend.logs, /RESEND_API_KEY belum dipasang/);
  const tanpaToken = await jalankanMain(dir, { env: { RESEND_API_KEY: 're_uji', LANGGANAN_SYNC_TOKEN: '' } });
  assert.equal(tanpaToken.code, 0);
  assert.equal(tanpaToken.calls.daftar.length, 0);
  assert.match(tanpaToken.logs, /LANGGANAN_SYNC_TOKEN belum dipasang/);
});

test('main(): artikel di JSON tapi file tidak ada -> exit 0 tanpa kirim', async () => {
  const dir = buatRepoTiruan();
  tulisNotify(dir, [{ path: 'src/content/berita/tidak-ada.md' }]);
  const { code, calls, logs } = await jalankanMain(dir);
  assert.equal(code, 0);
  assert.equal(calls.resend.length, 0);
  assert.match(logs, /tidak ditemukan di repo/);
});
