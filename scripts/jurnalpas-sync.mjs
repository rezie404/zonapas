#!/usr/bin/env node
/**
 * jurnalpas-sync.mjs — Auto-publish artikel ZonaPas ke JurnalPas (WordPress.com).
 *
 * CARA KERJA
 * ---------
 * Dijalankan oleh GitHub Action `.github/workflows/jurnalpas-sync.yml` setiap ada
 * push ke main yang mengubah `src/content/berita/*.md`. Untuk tiap file yang berubah:
 *
 *   - Dihapus (D)            → lewati (post JurnalPas TIDAK dihapus).
 *   - Baru (A) tanpa ID      → BUAT post baru di JurnalPas (status publish).
 *   - Baru (A) dengan ID     → UBAH post itu (defensif; seharusnya tidak terjadi).
 *   - Diubah (M) dengan ID   → UBAH post itu (bukan buat baru).
 *   - Diubah (M) tanpa ID    → LEWATI dengan log jelas (mencegah duplikat artikel
 *                               lama yang berasal dari JurnalPas).
 *
 * Setelah berhasil membuat post baru, ID post JurnalPas ditulis kembali ke
 * frontmatter artikel sebagai `jurnalpas_id` dan di-commit dengan pesan yang
 * mengandung "[skip ci]" supaya tidak memicu Action berulang.
 *
 * OTENTIKASI
 * ----------
 * Token OAuth2 WordPress.com diambil dari environment `WP_COM_ACCESS_TOKEN`
 * (di Action: secret GitHub `WP_COM_ACCESS_TOKEN`). Bila token TIDAK ADA dan
 * mode dry-run TIDAK diminta eksplisit (--dry-run), skrip GAGAL (exit 1)
 * dengan pesan yang jelas — supaya workflow tidak hijau padahal tidak ada
 * yang terkirim (12 Nov 2026). Mode dry-run eksplisit tetap keluar 0
 * tanpa memanggil API.
 *
 * PEMETAAN KATEGORI & TAG
 * -----------------------
 * Kategori JurnalPas memakai nama UPT (mis. "Rutan Kelas IIB Bengkulu"), bukan
 * 8 kategori berita ZonaPas (Pembinaan, Pengamanan, ...). Karena itu:
 *   - Kategori JurnalPas = field `upt` artikel (dicocokkan persis dengan nama
 *     kategori yang sudah ada di JurnalPas; bila belum ada, dibuat dulu lewat
 *     API; bila artikel tanpa `upt`, dipakai kategori "Pemasyarakatan").
 *   - Kategori berita ZonaPas (mis. "Sinergi") diteruskan sebagai TAG, bersama
 *     tag-tag artikel lainnya (didup-deplikasi tanpa memperhatikan kapital).
 *
 * FOTO SAMPUL & GAMBAR ISI
 * ------------------------
 * Foto sampul diunggah BYTES-nya dari repo (`public/images/...`) sebagai media
 * JurnalPas lalu dijadikan featured image. Gambar di badan narasi tidak
 * diunggah ulang — tautannya diubah menjadi URL absolut
 * (https://zonapas.web.id/images/...) supaya tetap tampil di JurnalPas.
 *
 * ISI ARTIKEL
 * -----------
 * Ringkasan (`summary`) dikirim sebagai excerpt DAN disisipkan sebagai paragraf
 * pembuka bila badan artikel belum diawali ringkasan itu (aturan yang sama
 * dengan template ZonaPas: bandingkan 100 karakter pertama) — sesuai format
 * post asli JurnalPas yang diawali paragraf ringkasan.
 *
 * PENGGUNAAN
 * ----------
 *   node scripts/jurnalpas-sync.mjs [--before SHA] [--after SHA]
 *       [--files STATUS<TAB>path ...] [--root DIR] [--dry-run]
 *       [--site jurnalpas.wordpress.com]
 *   WP_COM_ACCESS_TOKEN=... node scripts/jurnalpas-sync.mjs
 *
 * Tanpa dependensi eksternal — hanya API bawaan Node 18+ (fetch, FormData).
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const WP_API_BASE = 'https://public-api.wordpress.com/rest/v1.1';
export const DEFAULT_SITE = 'jurnalpas.wordpress.com';
export const ZONAPAS_BASE = 'https://zonapas.web.id';
export const FALLBACK_CATEGORY = 'Pemasyarakatan';
export const BERITA_DIR = 'src/content/berita';

// ---------------------------------------------------------------------------
// Util
// ---------------------------------------------------------------------------

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function normText(s) {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Parser frontmatter (subset YAML yang dipakai repo ini + keluaran Decap)
// ---------------------------------------------------------------------------

function parseScalar(raw) {
  const s = raw.trim();
  if (s === '') return '';
  if (s.startsWith('"')) {
    try { return JSON.parse(s); } catch { return s.replace(/^"|"$/g, ''); }
  }
  if (s.startsWith("'")) return s.slice(1, -1).replace(/''/g, "'");
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^-?\d+$/.test(s)) return Number(s);
  // Komentar di akhir skalar polos: "nilai # komentar"
  const hash = s.search(/\s+#/);
  return hash >= 0 ? s.slice(0, hash).trim() : s;
}

function parseFlowArray(raw) {
  const inner = raw.trim().replace(/^\[/, '').replace(/\]$/, '');
  const items = [];
  let cur = '';
  let quote = null;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
    } else if (ch === ',') {
      if (cur.trim() !== '') items.push(parseScalar(cur));
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim() !== '') items.push(parseScalar(cur));
  return items;
}

/**
 * Membaca blok frontmatter `--- ... ---` di awal file.
 * Mengembalikan { data, body }. Mendukung: string berpetik/polos, boolean,
 * angka, array alir [a, b], dan skalar blok (>- / > / |- / |) ala Decap,
 * serta baris lanjutan skalar polos (judul Decap yang terpotong 2 baris).
 */
export function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) throw new Error('Tidak ada blok frontmatter (--- ... ---).');
  const raw = m[1];
  const body = text.slice(m[0].length);
  const data = {};
  const lines = raw.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith('#')) { i++; continue; }
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!kv) { i++; continue; }
    const key = kv[1];
    const rest = kv[2] ?? '';
    // Skalar blok: >- / > / |- / |
    const bs = rest.match(/^([>|])([-+])?\s*(?:#.*)?$/);
    if (bs) {
      const folded = bs[1] === '>';
      const chomp = bs[2] || '';
      const buf = [];
      i++;
      while (i < lines.length && (lines[i].startsWith(' ') || lines[i].startsWith('\t') || lines[i].trim() === '')) {
        buf.push(lines[i]);
        i++;
      }
      // Buang baris kosong di akhir blok, hitung indent terkecil.
      while (buf.length && buf[buf.length - 1].trim() === '') buf.pop();
      let minIndent = Infinity;
      for (const b of buf) {
        if (b.trim() === '') continue;
        const ind = b.match(/^ */)[0].length;
        if (ind < minIndent) minIndent = ind;
      }
      if (minIndent === Infinity) minIndent = 0;
      const dedented = buf.map((b) => (b.trim() === '' ? '' : b.slice(minIndent)));
      let value;
      if (folded) {
        // Lipat: baris se-paragraf digabung spasi, baris kosong jadi newline.
        const paras = [];
        let cur = [];
        for (const l of dedented) {
          if (l === '') { if (cur.length) paras.push(cur.join(' ')); cur = []; }
          else cur.push(l);
        }
        if (cur.length) paras.push(cur.join(' '));
        value = paras.join('\n');
      } else {
        value = dedented.join('\n');
      }
      data[key] = chomp === '-' ? value.replace(/\n+$/, '') : value;
      continue;
    }
    // Array alir: [a, b]
    if (rest.trim().startsWith('[')) {
      data[key] = parseFlowArray(rest);
      i++;
      continue;
    }
    // Skalar polos/berpetik, beserta baris lanjutan (indent) bila ada.
    let value = parseScalar(rest);
    i++;
    if (typeof value === 'string') {
      const cont = [];
      while (i < lines.length && (lines[i].startsWith(' ') || lines[i].startsWith('\t')) && lines[i].trim() !== '') {
        cont.push(lines[i].trim());
        i++;
      }
      if (cont.length) value = `${value} ${cont.join(' ')}`.trim();
    }
    data[key] = value;
  }
  return { data, body };
}

/**
 * Menulis/mengganti `jurnalpas_id` di frontmatter (teks mentah, format lain
 * dipertahankan persis). Disisipkan setelah baris `source:` bila ada,
 * jika tidak sebelum penutup `---`.
 */
export function setJurnalpasId(fileText, id) {
  const m = fileText.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) throw new Error('Tidak ada blok frontmatter (--- ... ---).');
  let fm = m[1];
  const line = `jurnalpas_id: ${id}`;
  if (/^jurnalpas_id:\s*\d+/m.test(fm)) {
    fm = fm.replace(/^jurnalpas_id:\s*\d+/m, line);
  } else if (/^source:\s.*$/m.test(fm)) {
    fm = fm.replace(/^source:\s.*$/m, (s) => `${s}\n${line}`);
  } else {
    fm = `${fm}\n${line}`;
  }
  return `---\n${fm}\n---\n${fileText.slice(m[0].length)}`;
}

// ---------------------------------------------------------------------------
// Markdown -> HTML (subset yang dipakai artikel ZonaPas; tanpa dependensi)
// ---------------------------------------------------------------------------

export function absUrl(src, baseUrl = ZONAPAS_BASE) {
  if (/^(https?:)?\/\//i.test(src)) return src;
  if (src.startsWith('/')) return baseUrl.replace(/\/$/, '') + src;
  return src;
}

export function inlineHtml(s, baseUrl = ZONAPAS_BASE) {
  // Lindungi code span dari pemrosesan inline lain.
  const codes = [];
  let t = String(s).replace(/`([^`]+)`/g, (_, c) => {
    codes.push(c);
    return `\u0000${codes.length - 1}\u0000`;
  });
  t = escapeHtml(t);
  t = t.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
    (_, alt, src) => `<img src="${absUrl(src, baseUrl)}" alt="${alt}" />`);
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
    (_, text, href) => `<a href="${absUrl(href, baseUrl)}">${text}</a>`);
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>');
  t = t.replace(/(^|[^*\w])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/(^|[^_\w])_([^_]+)_/g, '$1<em>$2</em>');
  t = t.replace(/\u0000(\d+)\u0000/g, (_, n) => `<code>${escapeHtml(codes[Number(n)])}</code>`);
  return t;
}

const BLOCK_START = /^(#{1,6}\s|```|>|\s*[-*]\s|\s*\d+[.)]\s|(\*\*\*|---|___)\s*$)/;

export function markdownToHtml(md, { baseUrl = ZONAPAS_BASE } = {}) {
  const lines = String(md).replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    // Pagar kode
    if (/^```/.test(line)) {
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++;
      out.push(`<pre><code>${escapeHtml(buf.join('\n'))}</code></pre>`);
      continue;
    }
    // Judul
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      out.push(`<h${h[1].length}>${inlineHtml(h[2].trim(), baseUrl)}</h${h[1].length}>`);
      i++;
      continue;
    }
    // Garis horizontal
    if (/^(\*\*\*|---|___)\s*$/.test(line)) { out.push('<hr />'); i++; continue; }
    // Kutipan
    if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^>\s?/, '')); i++; }
      out.push(`<blockquote>${buf.map((l) => `<p>${inlineHtml(l.trim(), baseUrl)}</p>`).join('\n')}</blockquote>`);
      continue;
    }
    // Daftar tak berurut
    if (/^[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) { items.push(lines[i].replace(/^[-*]\s+/, '')); i++; }
      out.push(`<ul>\n${items.map((t) => `<li>${inlineHtml(t.trim(), baseUrl)}</li>`).join('\n')}\n</ul>`);
      continue;
    }
    // Daftar berurut
    if (/^\d+[.)]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\d+[.)]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\d+[.)]\s+/, '')); i++; }
      out.push(`<ol>\n${items.map((t) => `<li>${inlineHtml(t.trim(), baseUrl)}</li>`).join('\n')}\n</ol>`);
      continue;
    }
    // Paragraf: kumpulkan sampai baris kosong atau awal blok baru.
    const buf = [line];
    i++;
    while (i < lines.length && lines[i].trim() !== '' && !BLOCK_START.test(lines[i])) {
      buf.push(lines[i]);
      i++;
    }
    let html = '';
    buf.forEach((l, idx) => {
      const hard = / {2}$/.test(l);
      html += inlineHtml(l.replace(/ {2}$/, ''), baseUrl);
      if (idx < buf.length - 1) html += hard ? '<br />\n' : ' ';
    });
    out.push(`<p>${html}</p>`);
  }
  return out.join('\n\n');
}

// ---------------------------------------------------------------------------
// Keputusan buat / ubah / lewati
// ---------------------------------------------------------------------------

/**
 * status: huruf dari `git diff --name-status` (A/M/D/R).
 * hasId: artikel sudah punya jurnalpas_id di frontmatter.
 */
export function decideAction(status, hasId) {
  if (status === 'D') return { action: 'skip', reason: 'deleted (post JurnalPas tidak dihapus)' };
  if (hasId) return { action: 'update', reason: 'sudah punya jurnalpas_id' };
  if (status === 'A' || status === 'R') return { action: 'create', reason: 'artikel baru' };
  if (status === 'M') return { action: 'skip', reason: 'diubah tanpa jurnalpas_id — dilewati untuk mencegah duplikat' };
  return { action: 'skip', reason: `status tidak dikenal: ${status}` };
}

export function bodyStartsWithSummary(bodyText, summary) {
  if (!summary) return false;
  const b = normText(bodyText);
  const s = normText(summary);
  // Badan sudah diawali ringkasan (100 karakter pertama ringkasan) -> jangan gandakan.
  return b.startsWith(s.slice(0, 100));
}

/** Sisipkan ringkasan sebagai paragraf pembuka bila badan belum diawali ringkasan. */
export function mergeSummaryIntoContent(summary, bodyText, bodyHtml) {
  if (!summary || bodyStartsWithSummary(bodyText, summary)) return bodyHtml;
  return `<p>${escapeHtml(summary)}</p>\n\n${bodyHtml}`;
}

export function collectTags(fm) {
  const seen = new Set();
  const out = [];
  for (const t of [...(fm.tags || []), fm.category]) {
    if (!t) continue;
    const k = String(t).trim().toLowerCase();
    if (k && !seen.has(k)) { seen.add(k); out.push(String(t).trim()); }
  }
  return out;
}

export function toWpDate(publishDate) {
  if (!publishDate) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(publishDate))) return `${publishDate}T00:00:00+07:00`;
  const d = new Date(publishDate);
  if (Number.isNaN(d.getTime())) return String(publishDate);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}+07:00`;
}

export function buildPostPayload(fm, contentHtml, { categoryId, tags, featuredImageId } = {}) {
  const payload = {
    title: fm.title,
    content: contentHtml,
    excerpt: fm.summary || '',
    status: 'publish',
    date: toWpDate(fm.publishDate),
  };
  if (categoryId) payload.categories = [categoryId];
  if (tags && tags.length) payload.tags = tags;
  if (featuredImageId) payload.featured_image = featuredImageId;
  return payload;
}

/** Cari kategori berdasarkan nama (tak peduli kapital); fallback "Pemasyarakatan". */
export function resolveCategoryId(upt, categories) {
  const norm = (s) => String(s || '').trim().toLowerCase();
  if (upt) {
    const hit = (categories || []).find((c) => norm(c.name) === norm(upt));
    if (hit) return { id: hit.ID, name: hit.name, created: false };
  }
  const fb = (categories || []).find((c) => norm(c.name) === norm(FALLBACK_CATEGORY));
  if (fb) return { id: fb.ID, name: fb.name, created: false, fallback: true };
  return null;
}

export function mimeForImage(filename) {
  const ext = String(filename).split('.').pop().toLowerCase();
  return { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' }[ext] || 'image/jpeg';
}

// ---------------------------------------------------------------------------
// Klien WordPress.com API (memakai fetch global — bisa di-mock pada pengujian)
// ---------------------------------------------------------------------------

export function wpClient({ site = DEFAULT_SITE, token }) {
  const base = `${WP_API_BASE}/sites/${site}`;
  async function call(path, { method = 'GET', body, form = null } = {}) {
    const headers = { Authorization: `Bearer ${token}` };
    const init = { method, headers };
    if (form) init.body = form;
    else if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    const res = await fetch(`${base}${path}`, init);
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`WordPress.com API ${method} ${path} -> HTTP ${res.status}: ${text.slice(0, 300)}`);
    }
    return text ? JSON.parse(text) : {};
  }
  return {
    listCategories: () => call('/categories?number=100'),
    createCategory: (name) => call('/categories/new', { method: 'POST', body: { name } }),
    uploadMedia: async (bytes, filename, mime) => {
      const form = new FormData();
      form.append('media[]', new Blob([bytes], { type: mime }), filename);
      return call('/media/new', { method: 'POST', form });
    },
    createPost: (payload) => call('/posts/new', { method: 'POST', body: payload }),
    updatePost: (id, payload) => call(`/posts/${id}`, { method: 'POST', body: payload }),
    // Cari post dari judul (perbaikan ID yang hilang): API WordPress.com
    // mengembalikan daftar post yang judulnya MENGANDUNG kata kunci —
    // pencocokan persis dilakukan pemanggil (cariIdDariJudul).
    searchPosts: (q) => call('/posts?search=' + encodeURIComponent(q) + '&number=20'),
  };
}

/** Pastikan kategori ada: cocokkan nama, bila belum ada buat lewat API. */
export async function ensureCategory(client, upt, cache = {}) {
  if (!cache.list) cache.list = await client.listCategories();
  const cats = cache.list.categories || [];
  const hit = resolveCategoryId(upt, cats);
  if (hit && !hit.fallback) return hit;
  if (upt) {
    try {
      const created = await client.createCategory(upt);
      if (created && created.ID) {
        cache.list.categories.push({ ID: created.ID, name: created.name || upt });
        return { id: created.ID, name: created.name || upt, created: true };
      }
    } catch (err) {
      console.log(`  ! Gagal membuat kategori "${upt}": ${err.message} — memakai fallback.`);
    }
  }
  if (hit) return hit; // fallback Pemasyarakatan
  return null;
}

// ---------------------------------------------------------------------------
// Perubahan file dari git
// ---------------------------------------------------------------------------

export function parseNameStatus(output) {
  const changes = [];
  for (const line of String(output || '').split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    const status = (parts[0] || '').trim();
    const path = parts[parts.length - 1];
    if (!path || !path.startsWith(BERITA_DIR + '/') || !path.endsWith('.md')) continue;
    const code = status.replace(/[^AMDR]/g, '') || 'M';
    changes.push({ status: code, path });
  }
  return changes;
}

function listAllBeritaFiles(root) {
  const dir = join(root, BERITA_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => ({ status: 'M', path: `${BERITA_DIR}/${f}` }));
}

function gitDiffNameStatus(root, before, after) {
  try {
    const out = execFileSync('git', ['diff', '--name-status', before, after, '--', BERITA_DIR], {
      cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    return parseNameStatus(out);
  } catch {
    return null;
  }
}

export function getChangedFiles({ root, before, after, filesArg } = {}) {
  if (filesArg) {
    // Format per baris: "STATUS<TAB>path" atau sekadar "path" (= M).
    return filesArg.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
      const parts = l.split('\t');
      if (parts.length >= 2) return { status: parts[0].trim().toUpperCase(), path: parts.slice(1).join('\t') };
      return { status: 'M', path: l };
    }).filter((c) => c.path.startsWith(BERITA_DIR + '/') && c.path.endsWith('.md'));
  }
  const isZero = !before || /^0+$/.test(String(before));
  if (!isZero && after) {
    const diff = gitDiffNameStatus(root, before, after);
    if (diff) return diff;
    console.log('  ! git diff gagal — fallback: semua artikel dianggap diubah (M).');
  } else {
    console.log('  ! SHA awal tidak tersedia (push pertama) — fallback: semua artikel dianggap diubah (M).');
  }
  return listAllBeritaFiles(root);
}

// ---------------------------------------------------------------------------
// Pemrosesan satu artikel
// ---------------------------------------------------------------------------

/** Normalisasi judul untuk pencocokan: buang tag HTML + entitas umum. */
export function normalisasiJudulWp(judul) {
  return String(judul || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Cari ID post JurnalPas dari judul (perbaikan ID yang hilang, 12 Nov 2026).
 * Mengembalikan ID bila TEPAT SATU post cocok setelah normalisasi; bila
 * tidak ada atau lebih dari satu yang cocok, kembalikan null (jangan tebak
 * — mencegah duplikat). Pelonggaran 13 Nov 2026: bila tidak ada yang cocok
 * persis, coba lagi dengan toleransi tanda baca/spasi (hanya huruf/angka
 * yang dibandingkan — "Star - Proaksi" sama dengan "Star-proaksi").
 */
export function cariIdDariJudul(posts, judul) {
  const cari = normalisasiJudulWp(judul);
  if (!cari) return null;
  const daftar = Array.isArray(posts) ? posts : [];
  const cocok = daftar.filter((p) => normalisasiJudulWp(p && p.title) === cari);
  if (cocok.length === 1) return cocok[0].ID;
  if (cocok.length > 1) return null;
  // Pelonggaran (13 Nov 2026): toleransi tanda baca/spasi — hanya
  // huruf/angka yang dibandingkan. Tetap null bila 0 atau >1 cocok.
  const longgar = (s) => normalisasiJudulWp(s).replace(/[^a-z0-9]/g, '');
  const cariLonggar = longgar(judul);
  if (!cariLonggar) return null;
  const cocokLonggar = daftar.filter((p) => longgar(p && p.title) === cariLonggar);
  return cocokLonggar.length === 1 ? cocokLonggar[0].ID : null;
}

async function processFile({ root, site, client, dryRun, change, categoriesCache }) {
  const { status, path } = change;
  const absPath = join(root, path);
  if (status === 'D') {
    console.log(`SKIP ${path} — dihapus di ZonaPas (post JurnalPas tidak dihapus).`);
    return { decision: 'skip', path, reason: 'deleted' };
  }
  if (!existsSync(absPath)) {
    console.log(`SKIP ${path} — file tidak ditemukan di repo.`);
    return { decision: 'skip', path, reason: 'missing' };
  }
  const text = readFileSync(absPath, 'utf8');
  let fm;
  let body;
  try {
    ({ data: fm, body } = parseFrontmatter(text));
  } catch (err) {
    throw new Error(`${path}: ${err.message}`);
  }
  const hasId = Number.isInteger(fm.jurnalpas_id);
  let { action, reason } = decideAction(status, hasId);
  let recovered = false;
  // Perbaikan ID yang hilang (12 Nov 2026): artikel yang diubah tanpa
  // jurnalpas_id sebelumnya dilewati SELAMANYA — termasuk bila ID-nya
  // hilang karena commit-back gagal. Coba pulihkan dengan mencocokkan
  // judul persis di JurnalPas; bila tidak ada atau ambigu, tetap lewati
  // (jangan buat duplikat). Hanya di jalur kirim sungguhan (client ada).
  if (action === 'skip' && status === 'M' && !hasId && !dryRun && client) {
    try {
      const res = await client.searchPosts(fm.title);
      const id = cariIdDariJudul(res && res.posts, fm.title);
      if (Number.isInteger(id)) {
        fm.jurnalpas_id = id;
        action = 'update';
        reason = `tanpa jurnalpas_id — dipulihkan dari JurnalPas (cocok judul, post ID ${id})`;
        recovered = true;
        console.log(`PULIH ${path} — jurnalpas_id ${id} ditemukan dari judul; akan diperbarui, bukan dibuat baru.`);
      }
    } catch (err) {
      console.log(`  ! Gagal mencari post dari judul untuk ${path}: ${err.message} — tetap dilewati.`);
    }
  }
  if (action === 'skip') {
    console.log(`SKIP ${path} — ${reason}.`);
    return { decision: 'skip', path, reason };
  }
  const bodyHtml = mergeSummaryIntoContent(fm.summary, body, markdownToHtml(body));
  const tags = collectTags(fm);

  if (dryRun) {
    const payload = buildPostPayload(fm, bodyHtml, {
      categoryId: undefined,
      tags,
      featuredImageId: undefined,
    });
    payload.categories = [fm.upt || FALLBACK_CATEGORY];
    payload.featured_image = fm.image ? `(akan diunggah dari ${fm.image})` : undefined;
    console.log(`DRY-RUN ${action.toUpperCase()} ${path}${hasId ? ` (jurnalpas_id ${fm.jurnalpas_id})` : ''}:`);
    console.log(JSON.stringify(payload, null, 2));
    return { decision: `dry-run-${action}`, path, reason, payload };
  }

  // --- Jalur kirim sungguhan (token ada) ---
  const category = await ensureCategory(client, fm.upt, categoriesCache);
  let featuredImageId;
  if (fm.image && String(fm.image).startsWith('/images/')) {
    const imgPath = join(root, 'public', String(fm.image).replace(/^\//, ''));
    if (existsSync(imgPath)) {
      const bytes = readFileSync(imgPath);
      const up = await client.uploadMedia(bytes, basename(imgPath), mimeForImage(imgPath));
      featuredImageId = up?.media?.[0]?.ID;
      console.log(`  Gambar sampul diunggah: media ID ${featuredImageId} (${basename(imgPath)}, ${bytes.length} byte).`);
    } else {
      console.log(`  ! Gambar sampul tidak ditemukan di repo (${fm.image}) — lanjut tanpa featured image.`);
    }
  }
  const payload = buildPostPayload(fm, bodyHtml, {
    categoryId: category ? category.id : undefined,
    tags,
    featuredImageId,
  });
  let post;
  if (action === 'create') {
    post = await client.createPost(payload);
  } else {
    post = await client.updatePost(fm.jurnalpas_id, payload);
  }
  console.log(`${action === 'create' ? 'DIBUAT' : 'DIPERBARUI'} ${path} -> JurnalPas post ID ${post.ID} (${post.URL || ''})`);
  return { decision: action, path, reason, postId: post.ID, postUrl: post.URL || '', recovered };
}

// ---------------------------------------------------------------------------
// main()
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { before: '', after: '', files: '', root: '', dryRun: false, site: '' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--before') args.before = argv[++i] || '';
    else if (a === '--after') args.after = argv[++i] || '';
    else if (a === '--files') args.files = argv[++i] || '';
    else if (a === '--root') args.root = argv[++i] || '';
    else if (a === '--site') args.site = argv[++i] || '';
    else if (a === '--dry-run') args.dryRun = true;
  }
  return args;
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const root = resolve(args.root || process.cwd());
  const site = args.site || process.env.WP_SITE || DEFAULT_SITE;
  const token = process.env.WP_COM_ACCESS_TOKEN || '';
  // Tanpa token + tanpa --dry-run eksplisit: GAGAL (exit 1). Sebelumnya
  // skrip diam-diam beralih ke dry-run dan workflow tetap hijau padahal
  // tidak ada yang terkirim ke JurnalPas (12 Nov 2026).
  if (!token && !args.dryRun) {
    console.error('ERROR: WP_COM_ACCESS_TOKEN belum dipasang — tidak ada yang dikirim ke JurnalPas.');
    console.error('Pasang secret WP_COM_ACCESS_TOKEN di repo Settings → Secrets and variables → Actions, lalu jalankan ulang.');
    return 1;
  }
  const dryRun = args.dryRun || !token;
  if (!token) {
    console.log('WP_COM_ACCESS_TOKEN belum dipasang — mode dry-run: tidak ada yang dikirim ke JurnalPas.');
    console.log('Pasang secret WP_COM_ACCESS_TOKEN di repo Settings → Secrets and variables → Actions untuk mengaktifkan pengiriman.');
  }
  const changes = getChangedFiles({
    root,
    before: args.before || process.env.GITHUB_EVENT_BEFORE || '',
    after: args.after || process.env.GITHUB_EVENT_AFTER || '',
    filesArg: args.files || '',
  });
  if (!changes.length) {
    console.log('Tidak ada perubahan artikel (src/content/berita/*.md). Selesai.');
    return 0;
  }
  console.log(`Memproses ${changes.length} file artikel yang berubah (situs: ${site}, mode: ${dryRun ? 'dry-run' : 'kirim'}).`);
  const client = dryRun ? null : wpClient({ site, token });
  const categoriesCache = { list: null };
  const results = [];
  const errors = [];
  const newIds = [];
  for (const change of changes) {
    try {
      const r = await processFile({ root, site, client, dryRun, change, categoriesCache });
      results.push(r);
      if (!dryRun && r.postId && (r.decision === 'create' || r.recovered)) {
        const absPath = join(root, change.path);
        const updated = setJurnalpasId(readFileSync(absPath, 'utf8'), r.postId);
        writeFileSync(absPath, updated);
        newIds.push({ path: change.path, id: r.postId });
      }
    } catch (err) {
      console.log(`ERROR ${change.path}: ${err.message}`);
      errors.push({ path: change.path, error: err.message });
    }
  }
  // Daftar artikel baru untuk notifikasi email pelanggan (dibaca
  // scripts/kirim-notifikasi.mjs pada langkah workflow berikutnya).
  // Ditulis setiap run — array kosong bila tidak ada — supaya skrip
  // notifikasi tidak pernah membaca file basi dari run sebelumnya.
  // Hanya decision "create" yang masuk; dry-run memakai "dry-run-create"
  // sehingga tidak ikut terkirim.
  const dibuat = results.filter((r) => r.decision === 'create').map((r) => ({ path: r.path }));
  mkdirSync(join(root, '.github'), { recursive: true });
  writeFileSync(join(root, '.github', 'notify-created.json'), `${JSON.stringify(dibuat, null, 2)}\n`);
  if (dibuat.length) console.log(`Artikel baru untuk notifikasi email: ${dibuat.map((n) => n.path).join(', ')}.`);
  // Commit kembali jurnalpas_id yang baru dibuat (dengan [skip ci]).
  if (!dryRun && newIds.length) {
    try {
      execFileSync('git', ['config', 'user.name', 'ZonaPas Sync'], { cwd: root });
      execFileSync('git', ['config', 'user.email', 'zonapas-sync@users.noreply.github.com'], { cwd: root });
      execFileSync('git', ['add', ...newIds.map((n) => n.path)], { cwd: root });
      execFileSync('git', ['commit', '-m', `Catat jurnalpas_id untuk ${newIds.length} artikel [skip ci]`], { cwd: root });
      execFileSync('git', ['push', 'origin', 'HEAD:main'], { cwd: root });
      console.log(`jurnalpas_id dicatat kembali untuk ${newIds.length} artikel: ${newIds.map((n) => `${n.path} → ${n.id}`).join(', ')}`);
    } catch (err) {
      console.log('ERROR: gagal commit kembali jurnalpas_id. Post sudah terbit di JurnalPas, tetapi ID belum tercatat di repo.');
      console.log(`Tambahkan manual ke frontmatter: ${newIds.map((n) => `${n.path} → jurnalpas_id: ${n.id}`).join(' ; ')}`);
      errors.push({ path: '(commit-back)', error: String(err.message || err).slice(0, 300) });
    }
  }
  const counts = {};
  for (const r of results) counts[r.decision] = (counts[r.decision] || 0) + 1;
  console.log(`Ringkasan: ${JSON.stringify(counts)}${errors.length ? `; ${errors.length} error` : ''}.`);
  return errors.length ? 1 : 0;
}

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().then((code) => { process.exitCode = code; }).catch((err) => {
    console.error(`FATAL: ${err.message}`);
    process.exitCode = 1;
  });
}
