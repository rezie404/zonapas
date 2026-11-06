/**
 * Pengujian scripts/jurnalpas-sync.mjs — dijalankan dengan:
 *   node --test scripts/jurnalpas-sync.test.mjs
 * Tanpa dependensi eksternal (node:test + node:assert bawaan).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseFrontmatter,
  markdownToHtml,
  decideAction,
  setJurnalpasId,
  resolveCategoryId,
  buildPostPayload,
  mergeSummaryIntoContent,
  collectTags,
  toWpDate,
  ensureCategory,
  wpClient,
  main,
} from './jurnalpas-sync.mjs';

// ---------------------------------------------------------------------------
// parseFrontmatter
// ---------------------------------------------------------------------------

test('parseFrontmatter: string berpetik, polos, boolean, angka, array alir', () => {
  const { data, body } = parseFrontmatter(
    '---\ntitle: "Judul A"\nsummary: Ringkasan polos.\ncategory: Sinergi\n'
    + "tags: [\"a b\", c, 'd e']\nauthor: Rezie\npublishDate: 2026-11-03\n"
    + 'featured: false\nbreaking: true\njurnalpas_id: 203\nupt: "Kanwil Ditjenpas Bengkulu"\n---\n\nIsi.\n',
  );
  assert.equal(data.title, 'Judul A');
  assert.equal(data.summary, 'Ringkasan polos.');
  assert.deepEqual(data.tags, ['a b', 'c', 'd e']);
  assert.equal(data.featured, false);
  assert.equal(data.breaking, true);
  assert.equal(data.jurnalpas_id, 203);
  assert.equal(data.publishDate, '2026-11-03');
  assert.equal(body.trim(), 'Isi.');
});

test('parseFrontmatter: skalar blok folded (>- ) dan literal (|-)', () => {
  const folded = parseFrontmatter(
    '---\ntitle: T\nsummary: >-\n  Paragraf pertama ringkasan\n  lanjutan baris kedua.\n\n'
    + '  Paragraf kedua ringkasan.\ncategory: Sinergi\n---\nIsi.',
  );
  assert.equal(
    folded.data.summary,
    'Paragraf pertama ringkasan lanjutan baris kedua.\nParagraf kedua ringkasan.',
  );
  const literal = parseFrontmatter('---\ntitle: T\nsummary: |-\n  baris satu\n  baris dua\n---\nIsi.');
  assert.equal(literal.data.summary, 'baris satu\nbaris dua');
});

test('parseFrontmatter: baris lanjutan skalar polos (judul Decap 2 baris)', () => {
  const { data } = parseFrontmatter(
    '---\ntitle: Judul Panjang Sekali\n  Lanjutan Judul Di Baris Kedua\ncategory: Sinergi\n---\nIsi.',
  );
  assert.equal(data.title, 'Judul Panjang Sekali Lanjutan Judul Di Baris Kedua');
});

test('parseFrontmatter: tanpa frontmatter -> throw', () => {
  assert.throws(() => parseFrontmatter('Tidak ada frontmatter.'), /frontmatter/);
});

// ---------------------------------------------------------------------------
// markdownToHtml
// ---------------------------------------------------------------------------

test('markdownToHtml: paragraf, judul, tebal, miring, tautan, gambar', () => {
  const html = markdownToHtml(
    '# Judul Bagian\n\nParagraf **tebal** dan *miring* serta [tautan](https://example.com/x).\n\n'
    + '![Keterangan foto](/images/foto.jpg)\n\nBaris satu  \nBaris dua.',
  );
  assert.match(html, /<h1>Judul Bagian<\/h1>/);
  assert.match(html, /<p>Paragraf <strong>tebal<\/strong> dan <em>miring<\/em> serta <a href="https:\/\/example\.com\/x">tautan<\/a>\.<\/p>/);
  assert.match(html, /<img src="https:\/\/zonapas\.web\.id\/images\/foto\.jpg" alt="Keterangan foto" \/>/);
  assert.match(html, /Baris satu<br \/>\nBaris dua\./);
});

test('markdownToHtml: daftar, kutipan, garis, pagar kode, escape HTML', () => {
  const html = markdownToHtml(
    '- satu\n- dua\n\n1. pertama\n2. kedua\n\n> kutipan penting\n\n---\n\n```\n<script>alert(1)</script>\n```\n\nTeks <b>mentah</b> & simbol.',
  );
  assert.match(html, /<ul>\n<li>satu<\/li>\n<li>dua<\/li>\n<\/ul>/);
  assert.match(html, /<ol>\n<li>pertama<\/li>\n<li>kedua<\/li>\n<\/ol>/);
  assert.match(html, /<blockquote><p>kutipan penting<\/p><\/blockquote>/);
  assert.match(html, /<hr \/>/);
  assert.match(html, /<pre><code>&lt;script&gt;alert\(1\)&lt;\/script&gt;<\/code><\/pre>/);
  assert.match(html, /Teks &lt;b&gt;mentah&lt;\/b&gt; &amp; simbol\./);
});

test('markdownToHtml: badan artikel asli ZonaPas (7 artikel) tanpa sisa penanda', async () => {
  const { readdirSync } = await import('node:fs');
  const dir = new URL('../src/content/berita/', import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith('.md'));
  assert.equal(files.length, 8);
  for (const f of files) {
    const text = readFileSync(new URL(`../src/content/berita/${f}`, import.meta.url), 'utf8');
    const { data, body } = parseFrontmatter(text);
    const html = markdownToHtml(body);
    assert.doesNotMatch(html, /!\[.*\]\(/, `${f}: penanda gambar Markdown tersisa`);
    assert.doesNotMatch(html, /\*\*/, `${f}: penanda tebal tersisa`);
    assert.match(html, /<img src="https:\/\/zonapas\.web\.id\/images\//, `${f}: gambar isi jadi URL absolut`);
    assert.match(html, /<p>/, `${f}: ada paragraf`);
    assert.ok(data.title && data.summary && data.publishDate, `${f}: field wajib ada`);
  }
});

// ---------------------------------------------------------------------------
// decideAction
// ---------------------------------------------------------------------------

test('decideAction: buat / ubah / lewati', () => {
  assert.deepEqual(decideAction('A', false), { action: 'create', reason: 'artikel baru' });
  assert.deepEqual(decideAction('A', true), { action: 'update', reason: 'sudah punya jurnalpas_id' });
  assert.deepEqual(decideAction('M', true), { action: 'update', reason: 'sudah punya jurnalpas_id' });
  assert.equal(decideAction('M', false).action, 'skip');
  assert.equal(decideAction('D', true).action, 'skip');
  assert.equal(decideAction('D', false).action, 'skip');
  assert.equal(decideAction('R', false).action, 'create');
});

// ---------------------------------------------------------------------------
// setJurnalpasId
// ---------------------------------------------------------------------------

test('setJurnalpasId: sisip setelah source, ganti bila sudah ada, fallback sebelum ---', () => {
  const a = setJurnalpasId('---\ntitle: T\nsource: "zonapas"\n---\nIsi.', 203);
  assert.match(a, /source: "zonapas"\njurnalpas_id: 203\n---/);
  const b = setJurnalpasId('---\ntitle: T\nsource: "zonapas"\njurnalpas_id: 99\n---\nIsi.', 203);
  assert.match(b, /jurnalpas_id: 203\n---/);
  assert.doesNotMatch(b, /jurnalpas_id: 99/);
  const c = setJurnalpasId('---\ntitle: T\ncategory: X\n---\nIsi.', 5);
  assert.match(c, /category: X\njurnalpas_id: 5\n---/);
  // Isi dan field lain tidak berubah.
  assert.match(a, /title: T\n/);
  assert.match(a, /Isi\.$/);
});

// ---------------------------------------------------------------------------
// Kategori & payload
// ---------------------------------------------------------------------------

test('resolveCategoryId: cocok persis tanpa peduli kapital, fallback Pemasyarakatan', () => {
  const cats = [
    { ID: 1, name: 'Rutan Kelas IIB Bengkulu' },
    { ID: 2, name: 'Pemasyarakatan' },
  ];
  assert.deepEqual(resolveCategoryId('rutan kelas iib bengkulu', cats), { id: 1, name: 'Rutan Kelas IIB Bengkulu', created: false });
  assert.deepEqual(resolveCategoryId('UPT Tidak Ada', cats), { id: 2, name: 'Pemasyarakatan', created: false, fallback: true });
  assert.equal(resolveCategoryId('UPT Tidak Ada', [{ ID: 1, name: 'Rutan Kelas IIB Bengkulu' }]), null);
});

test('collectTags: tag artikel + kategori, didup tanpa peduli kapital', () => {
  assert.deepEqual(collectTags({ tags: ['Sidang TPP', 'sinergi'], category: 'Sinergi' }), ['Sidang TPP', 'sinergi']);
  assert.deepEqual(collectTags({ tags: [], category: 'Pengamanan' }), ['Pengamanan']);
});

test('mergeSummaryIntoContent: sisip bila belum diawali ringkasan, jangan gandakan', () => {
  const summary = 'Bengkulu – Kantor Wilayah mengadakan pengarahan publikasi.';
  const bodyBaru = 'Bengkulu – Kantor Wilayah mengadakan pengarahan publikasi. Kegiatan ini ditujukan sebagai upaya.';
  const bodyLanjut = 'Atas pemaparan tersebut, Tim Sidang TPP menyetujui usulan program.';
  const html = '<p>Isi.</p>';
  assert.equal(mergeSummaryIntoContent(summary, bodyBaru, html), html);
  assert.match(mergeSummaryIntoContent(summary, bodyLanjut, html), /^<p>Bengkulu – Kantor Wilayah mengadakan pengarahan publikasi\.<\/p>/);
});

test('toWpDate: tanggal polos jadi ISO WIB', () => {
  assert.equal(toWpDate('2026-11-03'), '2026-11-03T00:00:00+07:00');
  assert.equal(toWpDate(undefined), undefined);
});

test('buildPostPayload: field lengkap', () => {
  const p = buildPostPayload(
    { title: 'T', summary: 'R', publishDate: '2026-11-03' },
    '<p>Isi.</p>',
    { categoryId: 7, tags: ['a'], featuredImageId: 42 },
  );
  assert.equal(p.title, 'T');
  assert.equal(p.excerpt, 'R');
  assert.equal(p.status, 'publish');
  assert.equal(p.date, '2026-11-03T00:00:00+07:00');
  assert.deepEqual(p.categories, [7]);
  assert.deepEqual(p.tags, ['a']);
  assert.equal(p.featured_image, 42);
});

// ---------------------------------------------------------------------------
// Klien API (fetch di-mock) + dry-run end-to-end
// ---------------------------------------------------------------------------

function mockFetch(routes) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET', body: init.body });
    for (const [match, res] of routes) {
      if (typeof match === 'string' ? url.includes(match) : match.test(url)) {
        return { ok: true, status: 200, text: async () => JSON.stringify(res) };
      }
    }
    return { ok: false, status: 404, text: async () => '{"error":"not_found"}' };
  };
  return calls;
}

test('ensureCategory: pakai yang ada, buat bila belum ada, fallback bila gagal', async () => {
  const calls = mockFetch([
    ['/categories?number=100', { found: 2, categories: [{ ID: 9, name: 'Pemasyarakatan' }] }],
    ['/categories/new', { ID: 55, name: 'Rutan Kelas IIB Bengkulu' }],
  ]);
  const client = wpClient({ token: 'T' });
  const cache = {};
  const a = await ensureCategory(client, 'Rutan Kelas IIB Bengkulu', cache);
  assert.deepEqual(a, { id: 55, name: 'Rutan Kelas IIB Bengkulu', created: true });
  const b = await ensureCategory(client, 'Rutan Kelas IIB Bengkulu', cache);
  assert.deepEqual(b, { id: 55, name: 'Rutan Kelas IIB Bengkulu', created: false });
  assert.equal(calls.filter((c) => c.url.includes('/categories/new')).length, 1);
  const c = await ensureCategory(client, 'UPT Fiktif', cache);
  assert.equal(c.id, 55); // dibuat (bukan fallback) karena create berhasil
  globalThis.fetch = undefined;
});

test('wpClient.createPost: bentuk permintaan benar', async () => {
  const calls = mockFetch([['/posts/new', { ID: 300, URL: 'https://jurnalpas.wordpress.com/2026/11/05/x/' }]]);
  const client = wpClient({ token: 'SECRET' });
  const post = await client.createPost({ title: 'T', content: '<p>X</p>', status: 'publish' });
  assert.equal(post.ID, 300);
  const call = calls[0];
  assert.match(call.url, /\/posts\/new$/);
  assert.equal(call.method, 'POST');
  assert.match(call.body, /"title":"T"/);
  globalThis.fetch = undefined;
});

test('main() dry-run: tanpa token tidak ada panggilan API; keputusan benar', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'jurnalpas-sync-test-'));
  const berita = join(dir, 'src', 'content', 'berita');
  const { mkdirSync } = await import('node:fs');
  mkdirSync(berita, { recursive: true });
  const baru = '---\ntitle: "Artikel Baru"\nsummary: "Ringkasan."\ncategory: Sinergi\ntags: [t1]\nauthor: Rezie\npublishDate: 2026-11-05\nimage: "/images/cover-baru.jpg"\nimageCaption: "Dok."\nfeatured: false\nbreaking: true\nupt: "Kanwil Ditjenpas Bengkulu"\nsource: "zonapas"\n---\n\nParagraf baru.\n';
  const ubahAdaId = '---\ntitle: "Artikel Lama"\nsummary: "R."\ncategory: Sinergi\ntags: []\nauthor: Rezie\npublishDate: 2026-11-03\nimage: "/images/cover-lama.jpg"\nimageCaption: "Dok."\nfeatured: false\nbreaking: false\nsource: "zonapas"\njurnalpas_id: 203\n---\n\nParagraf lama diubah.\n';
  const ubahTanpaId = '---\ntitle: "Artikel Tanpa ID"\nsummary: "R."\ncategory: Sinergi\ntags: []\nauthor: Rezie\npublishDate: 2026-11-03\nimage: "/images/cover-x.jpg"\nimageCaption: "Dok."\nfeatured: false\nbreaking: false\nsource: "zonapas"\n---\n\nParagraf diubah.\n';
  writeFileSync(join(berita, 'baru.md'), baru);
  writeFileSync(join(berita, 'ubah-ada-id.md'), ubahAdaId);
  writeFileSync(join(berita, 'ubah-tanpa-id.md'), ubahTanpaId);
  const calls = mockFetch([]);
  globalThis.fetch = async (url, init) => {
    calls.push({ url, method: init?.method || 'GET' });
    throw new Error('fetch tidak boleh dipanggil dalam dry-run');
  };
  delete process.env.WP_COM_ACCESS_TOKEN;
  const logs = [];
  const origLog = console.log;
  console.log = (...a) => logs.push(a.join(' '));
  let code;
  try {
    code = await main([
      '--root', dir, '--dry-run',
      '--files', 'A\tsrc/content/berita/baru.md\nM\tsrc/content/berita/ubah-ada-id.md\nM\tsrc/content/berita/ubah-tanpa-id.md\nD\tsrc/content/berita/hapus.md',
    ]);
  } finally {
    console.log = origLog;
    globalThis.fetch = undefined;
  }
  assert.equal(code, 0);
  assert.equal(calls.length, 0, 'dry-run tidak boleh memanggil API');
  const joined = logs.join('\n');
  assert.match(joined, /WP_COM_ACCESS_TOKEN belum dipasang/);
  assert.match(joined, /DRY-RUN CREATE src\/content\/berita\/baru\.md/);
  assert.match(joined, /DRY-RUN UPDATE src\/content\/berita\/ubah-ada-id\.md \(jurnalpas_id 203\)/);
  assert.match(joined, /SKIP src\/content\/berita\/ubah-tanpa-id\.md — diubah tanpa jurnalpas_id/);
  assert.match(joined, /SKIP src\/content\/berita\/hapus\.md — dihapus/);
  // Payload dry-run memuat judul, HTML, kategori, tag, gambar.
  assert.match(joined, /"title": "Artikel Baru"/);
  assert.match(joined, /Paragraf baru/);
  assert.match(joined, /Kanwil Ditjenpas Bengkulu/);
  assert.match(joined, /cover-baru\.jpg/);
});
