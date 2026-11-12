#!/usr/bin/env node
/**
 * reconcile-headline.mjs — Reconciler Headline berkala untuk jalur Decap CMS.
 *
 * MASALAH (B4, 13 Nov 2026)
 * -------------------------
 * Decap CMS menulis langsung ke GitHub API dari browser tanpa melewati
 * Worker — tanpa sapuan `cabutHeadlineLain`, tanpa `validateArticle`,
 * tanpa normalisasi judul, tanpa aturan 1 foto badan. Satu centang
 * Headline di Decap menciptakan Headline kedua secara permanen (aturan
 * "hanya satu Headline" dilanggar tanpa peringatan apa pun).
 *
 * CARA KERJA
 * ----------
 * Dijalankan GitHub Action `.github/workflows/headline-reconciler.yml`
 * setiap hari 02:00 UTC (09:00 WIB — sama dengan cron harian Worker) dan
 * bisa dijalankan manual (workflow_dispatch). Skrip memindai
 * `src/content/berita/*.md`:
 *
 *   - 0 atau 1 `featured: true` → tidak ada yang diubah, keluar 0.
 *   - Lebih dari 1 → pertahankan yang `publishDate`-nya terbaru (bila
 *     seri, nama berkas terbesar — SAMA seperti `reconcileHeadline` di
 *     Worker), cabut `featured: true` sisanya menjadi `featured: false`
 *     di frontmatter saja (isi badan tidak disentuh).
 *
 * Perubahan di-commit kembali ke main dengan pesan "[skip ci]" supaya
 * tidak memicu Action berulang (pola yang sama dengan commit-back
 * `jurnalpas_id` di scripts/jurnalpas-sync.mjs).
 *
 * Deteksi `featured: true` memakai regex longgar yang sama dengan Worker
 * (`RE_FEATURED_TRUE`): true / True / TRUE, dikutip "true" / 'true', dan
 * komentar di akhir baris — hanya di dalam blok frontmatter.
 *
 * Kegagalan (berkas tidak terbaca, commit/push gagal) membuat skrip
 * keluar 1 supaya workflow MERAH — kegagalan senyap adalah yang membuat
 * B4 audit lalu tidak ketahuan (lihat K19 audit 13 Nov 2026).
 *
 * PENGGUNAAN
 * ----------
 *   node scripts/reconcile-headline.mjs [--root DIR] [--dry-run]
 *
 * Tanpa dependensi eksternal — hanya API bawaan Node 18+.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const BERITA_DIR = 'src/content/berita';

// Regex yang sama dengan Worker (worker.js: RE_FEATURED_TRUE): huruf
// besar/kecil bebas, boleh dikutip, boleh ada komentar di akhir baris.
export const RE_FEATURED_TRUE = /^featured:\s*["']?true["']?\s*(#.*)?$/im;

// Apakah frontmatter artikel ini bertanda Headline?
export function apakahFeatured(teks) {
  const bagian = String(teks || '').split('---');
  return bagian.length >= 3 && RE_FEATURED_TRUE.test(bagian[1]);
}

// Cabut tanda Headline dari frontmatter saja (isi badan tidak disentuh).
// Regex ganti memakai grup tangkap untuk spasi/komentar di akhir baris:
// RE_FEATURED_TRUE di atas TIDAK boleh dipakai untuk replace — \s* di
// ujungnya menelan \n bila featured adalah baris TERAKHIR frontmatter,
// sehingga "featured: false" menempel pada penutup --- ("featured:
// false---") dan frontmatter rusak. (Cacat yang sama ada di
// ubahFeaturedFalse Worker — di sana featured hampir selalu diikuti
// baris lain sehingga belum pernah terpicu; dilaporkan terpisah.)
const RE_FEATURED_TRUE_GANTI = /^featured:(\s*)["']?true["']?(\s*(?:#.*)?)$/im;
export function ubahFeaturedFalse(teks) {
  const bagian = String(teks || '').split('---');
  if (bagian.length < 3) return String(teks || '');
  bagian[1] = bagian[1].replace(RE_FEATURED_TRUE_GANTI, 'featured:$1false$2');
  return bagian.join('---');
}

// Tanggal terbit (YYYY-MM-DD) dari frontmatter; '' bila tidak ada.
export function tanggalTerbit(teks) {
  const m = String(teks || '').match(/^publishDate:\s*(\d{4}-\d{2}-\d{2})/m);
  return m ? m[1] : '';
}

// Pilih satu Headline yang dipertahankan dari daftar kandidat
// { path, tanggal }: publishDate terbaru, bila seri nama berkas terbesar.
// Mengembalikan path yang dipertahankan (null bila daftar kosong).
export function pilihHeadlineYangDipertahankan(kandidat) {
  if (!kandidat.length) return null;
  const urut = [...kandidat].sort((a, b) => b.tanggal.localeCompare(a.tanggal) || b.path.localeCompare(a.path));
  return urut[0].path;
}

function parseArgs(argv) {
  const args = { root: resolve(dirname(fileURLToPath(import.meta.url)), '..'), dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root' && argv[i + 1]) args.root = resolve(argv[++i]);
    else if (argv[i] === '--dry-run') args.dryRun = true;
    else if (argv[i] === '--help' || argv[i] === '-h') {
      console.log('Penggunaan: node scripts/reconcile-headline.mjs [--root DIR] [--dry-run]');
      process.exit(0);
    }
  }
  return args;
}

export async function main(argv = process.argv.slice(2)) {
  const { root, dryRun } = parseArgs(argv);
  const dir = join(root, BERITA_DIR);
  if (!existsSync(dir)) {
    console.log(`ERROR: direktori tidak ditemukan: ${dir}`);
    return 1;
  }
  const errors = [];
  const tampil = [];
  const berkas = readdirSync(dir).filter((f) => f.endsWith('.md')).sort();
  for (const nama of berkas) {
    const rel = `${BERITA_DIR}/${nama}`;
    try {
      const teks = readFileSync(join(dir, nama), 'utf8');
      if (!apakahFeatured(teks)) continue;
      tampil.push({ path: rel, tanggal: tanggalTerbit(teks) });
    } catch (err) {
      console.log(`ERROR ${rel}: tidak bisa dibaca (${err.message})`);
      errors.push({ path: rel, error: err.message });
    }
  }
  console.log(`Diperiksa ${berkas.length} artikel, ${tampil.length} bertanda Headline.`);
  if (tampil.length <= 1) {
    if (tampil.length === 1) console.log(`Headline tunggal OK: ${tampil[0].path} (${tampil[0].tanggal || 'tanpa tanggal'}).`);
    else console.log('Tidak ada Headline — tidak ada yang diubah.');
    return errors.length ? 1 : 0;
  }
  const dipertahankan = pilihHeadlineYangDipertahankan(tampil);
  const dicabut = tampil.filter((t) => t.path !== dipertahankan);
  console.log(`Headline dipertahankan: ${dipertahankan}.`);
  for (const t of dicabut) console.log(`${dryRun ? 'DRY-RUN cabut' : 'Cabut'} Headline: ${t.path} (${t.tanggal || 'tanpa tanggal'}).`);
  if (dryRun) {
    console.log(`Dry-run: ${dicabut.length} Headline akan dicabut, tidak ada berkas yang diubah.`);
    return errors.length ? 1 : 0;
  }
  const diubah = [];
  for (const t of dicabut) {
    try {
      const abs = join(root, t.path);
      writeFileSync(abs, ubahFeaturedFalse(readFileSync(abs, 'utf8')));
      diubah.push(t.path);
    } catch (err) {
      console.log(`ERROR ${t.path}: gagal mencabut Headline (${err.message})`);
      errors.push({ path: t.path, error: err.message });
    }
  }
  // Commit kembali perubahan (dengan [skip ci]) — pola yang sama dengan
  // commit-back jurnalpas_id di scripts/jurnalpas-sync.mjs.
  if (diubah.length) {
    try {
      execFileSync('git', ['config', 'user.name', 'ZonaPas Headline Reconciler'], { cwd: root });
      execFileSync('git', ['config', 'user.email', 'zonapas-reconciler@users.noreply.github.com'], { cwd: root });
      execFileSync('git', ['add', ...diubah], { cwd: root });
      execFileSync('git', ['commit', '-m', `Cabut Headline ganda, pertahankan ${dipertahankan} [skip ci]`], { cwd: root });
      execFileSync('git', ['push', 'origin', 'HEAD:main'], { cwd: root });
      console.log(`Headline dicabut untuk ${diubah.length} artikel: ${diubah.join(', ')}.`);
    } catch (err) {
      console.log('ERROR: gagal commit kembali pencabutan Headline. Perubahan sudah ditulis lokal tapi belum ter-push.');
      console.log(`Perbaiki manual: ${diubah.map((p) => `${p} → featured: false`).join(' ; ')}`);
      errors.push({ path: '(commit-back)', error: String(err.message || err).slice(0, 300) });
    }
  }
  console.log(`Ringkasan: ${tampil.length} Headline ditemukan, ${diubah.length} dicabut, ${errors.length} error.`);
  return errors.length ? 1 : 0;
}

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().then((code) => { process.exitCode = code; }).catch((err) => {
    console.error(`FATAL: ${err.message}`);
    process.exitCode = 1;
  });
}
