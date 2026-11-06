#!/usr/bin/env node
/**
 * kirim-notifikasi.mjs — Kirim email notifikasi artikel baru ke pelanggan ZonaPas.
 *
 * CARA KERJA
 * ---------
 * Dijalankan oleh GitHub Action `.github/workflows/jurnalpas-sync.yml`
 * SETELAH langkah sinkron JurnalPas. Daftar artikel baru dibaca dari
 * `.github/notify-created.json` yang ditulis `scripts/jurnalpas-sync.mjs`
 * (satu sumber kebenaran — skrip ini tidak mengulang git diff).
 *
 *   1. Baca JSON -> untuk tiap path, parse frontmatter (title, summary,
 *      image); slug = nama file tanpa .md.
 *   2. Ambil daftar pelanggan aktif dari Worker:
 *      GET https://zonapas.web.id/redaksi/api/langganan/daftar
 *      (Authorization: Bearer <LANGGANAN_SYNC_TOKEN>).
 *   3. Untuk tiap pelanggan: POST https://api.resend.com/emails
 *      (kunci dari env RESEND_API_KEY), jeda ~150 ms antar kirim
 *      (batas laju paket gratis 10 req/detik).
 *
 * PENANGANAN GAGAL
 * ----------------
 * Skrip ini TIDAK PERNAH mengembalikan exit code bukan-0 karena kegagalan
 * notifikasi: 429 dari Resend -> catat "batas harian tercapai" lalu berhenti
 * dengan tenang; gagal per penerima -> catat, lanjut ke penerima berikut;
 * daftar endpoint 401/500 -> catat, keluar 0. Hanya kesalahan pemakaian
 * (mis. isi file JSON rusak) yang boleh exit 1.
 *
 * PENGGUNAAN
 * ----------
 *   RESEND_API_KEY=... LANGGANAN_SYNC_TOKEN=... node scripts/kirim-notifikasi.mjs [--root DIR]
 *
 * Tanpa dependensi eksternal — hanya API bawaan Node 18+ (fetch).
 */

import { existsSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { absUrl, escapeHtml, parseFrontmatter } from './jurnalpas-sync.mjs';

export const ZONAPAS_BASE = 'https://zonapas.web.id';
export const NOTIFY_JSON = '.github/notify-created.json';
export const JEDA_MS = 150;

/**
 * Email artikel baru — subjek: judul artikel apa adanya (tanpa awalan
 * "[ZonaPas]"). Semua nilai dari frontmatter di-escape; tautan berhenti
 * berbeda per penerima (alasan pengiriman satu-per-satu, bukan satu email
 * ke banyak alamat).
 */
export function emailArtikelBaru({ title, summary, image, slug, token }) {
  const url = `${ZONAPAS_BASE}/berita/${slug}/`;
  const berhenti = `${ZONAPAS_BASE}/redaksi/api/langganan/berhenti?token=${token}`;
  const judul = escapeHtml(title);
  const ringkasan = escapeHtml(summary || '');
  const gambar = image
    ? `<p style="margin:0 0 16px;"><img src="${absUrl(image, ZONAPAS_BASE)}" alt="" style="display:block;width:100%;height:auto;border-radius:8px;"></p>`
    : '';
  const html = `<!DOCTYPE html><html lang="id"><head><meta charset="utf-8"></head><body style="margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:#f2f5fa;color:#16233d;"><div style="max-width:560px;margin:0 auto;padding:24px 16px;"><div style="background:#0A2540;color:#fff;border-radius:10px 10px 0 0;padding:20px 24px;"><div style="font-size:22px;font-weight:800;">ZonaPas</div><div style="font-size:13px;color:#cbd5e1;margin-top:2px;">Melihat Pemasyarakatan Lebih Dekat</div></div><div style="background:#fff;border:1px solid #dbe3ef;border-top:0;border-radius:0 0 10px 10px;padding:24px;"><h1 style="margin:0 0 12px;font-size:20px;line-height:1.4;"><a href="${url}" style="color:#0A2540;text-decoration:none;">${judul}</a></h1>${gambar}<p style="margin:0 0 16px;line-height:1.7;">${ringkasan}</p><p style="margin:20px 0;"><a href="${url}" style="display:inline-block;background:#FACC15;color:#0A2540;font-weight:700;text-decoration:none;border-radius:8px;padding:12px 20px;">Baca selengkapnya &rarr;</a></p><p style="margin:16px 0 0;color:#5a6b85;font-size:13px;border-top:1px solid #e3e9f2;padding-top:16px;">Anda menerima email ini karena berlangganan berita ZonaPas. <a href="${berhenti}" style="color:#5a6b85;">Berhenti berlangganan</a></p></div></div></body></html>`;
  const text = `ZonaPas — ${title}\n\n${summary || ''}\n\nBaca selengkapnya: ${url}\n\n---\nAnda menerima email ini karena berlangganan berita ZonaPas.\nBerhenti berlangganan: ${berhenti}`;
  return { subject: title, html, text };
}

/**
 * Kirim satu artikel ke semua pelanggan (satu-per-satu).
 * Mengembalikan { terkirim, gagal, batasHarian, belumTerkirim }.
 * 429 -> berhenti di tempat (batas harian paket gratis); penerima yang
 * gagal (400/5xx lain atau jaringan) dicatat lalu lanjut ke berikut.
 */
export async function kirimSatuArtikel({ artikel, pelanggan, resendApiKey, fetchFn = fetch, jedaMs = JEDA_MS }) {
  let terkirim = 0, gagal = 0, batasHarian = false, belumTerkirim = 0;
  for (let i = 0; i < pelanggan.length; i++) {
    if (i > 0 && jedaMs > 0) await new Promise((res) => setTimeout(res, jedaMs));
    const p = pelanggan[i];
    const pesan = emailArtikelBaru({ ...artikel, token: p.token });
    let r;
    try {
      r = await fetchFn('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'ZonaPas <berita@zonapas.web.id>',
          reply_to: 'redaksi@zonapas.web.id',
          to: [p.email], subject: pesan.subject, html: pesan.html, text: pesan.text,
        }),
      });
    } catch (err) {
      console.log(`  ! Gagal mengirim ke ${p.email}: ${err.message} — lanjut ke penerima berikut.`);
      gagal++;
      continue;
    }
    if (r.status === 429) {
      belumTerkirim = pelanggan.length - i;
      console.log(`  ! Batas harian Resend tercapai — ${belumTerkirim} pelanggan belum terkirim untuk artikel "${artikel.title}". Berhenti dengan tenang.`);
      batasHarian = true;
      break;
    }
    if (!r.ok) {
      console.log(`  ! Gagal mengirim ke ${p.email} (Resend ${r.status}) — lanjut ke penerima berikut.`);
      gagal++;
    } else {
      terkirim++;
    }
  }
  return { terkirim, gagal, batasHarian, belumTerkirim };
}

function parseArgs(argv) {
  const args = { root: '' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root') args.root = argv[++i] || '';
  }
  return args;
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const root = resolve(args.root || process.cwd());
  const jsonPath = join(root, NOTIFY_JSON);
  if (!existsSync(jsonPath)) {
    console.log('tidak ada artikel baru — file .github/notify-created.json tidak ditemukan.');
    return 0;
  }
  let dibuat;
  try {
    dibuat = JSON.parse(readFileSync(jsonPath, 'utf8'));
  } catch (err) {
    console.error(`FATAL: isi ${jsonPath} bukan JSON yang valid: ${err.message}`);
    return 1;
  }
  if (!Array.isArray(dibuat) || !dibuat.length) {
    console.log('tidak ada artikel baru — tidak ada notifikasi yang dikirim.');
    return 0;
  }
  // Baca artikel baru dari repo (frontmatter + slug dari nama file).
  const artikel = [];
  for (const item of dibuat) {
    const p = typeof item === 'string' ? item : item.path;
    if (!p) continue;
    const absPath = join(root, p);
    if (!existsSync(absPath)) {
      console.log(`  ! Artikel tidak ditemukan di repo (${p}) — dilewati.`);
      continue;
    }
    const { data } = parseFrontmatter(readFileSync(absPath, 'utf8'));
    const slug = basename(p).replace(/\.md$/, '');
    artikel.push({ path: p, slug, title: data.title || slug, summary: data.summary || '', image: data.image || '' });
  }
  if (!artikel.length) {
    console.log('tidak ada artikel baru yang bisa dibaca — tidak ada notifikasi yang dikirim.');
    return 0;
  }
  const syncToken = process.env.LANGGANAN_SYNC_TOKEN || '';
  const resendKey = process.env.RESEND_API_KEY || '';
  if (!syncToken) {
    console.log('LANGGANAN_SYNC_TOKEN belum dipasang — notifikasi dilewati (artikel tetap terbit).');
    return 0;
  }
  if (!resendKey) {
    console.log('RESEND_API_KEY belum dipasang — notifikasi dilewati (artikel tetap terbit).');
    return 0;
  }
  // Daftar pelanggan aktif dari Worker (Bearer token bersama).
  let daftar;
  try {
    const r = await fetch(`${ZONAPAS_BASE}/redaksi/api/langganan/daftar`, {
      headers: { Authorization: `Bearer ${syncToken}` },
    });
    if (!r.ok) {
      console.log(`Daftar pelanggan tidak bisa diambil (HTTP ${r.status}) — LANGGANAN_SYNC_TOKEN tidak cocok atau Worker belum dikonfigurasi. Notifikasi dilewati.`);
      return 0;
    }
    daftar = await r.json();
  } catch (err) {
    console.log(`Daftar pelanggan tidak bisa diambil (${err.message}) — notifikasi dilewati.`);
    return 0;
  }
  const pelanggan = Array.isArray(daftar?.pelanggan) ? daftar.pelanggan : [];
  if (!pelanggan.length) {
    console.log('tidak ada pelanggan aktif — tidak ada notifikasi yang dikirim.');
    return 0;
  }
  console.log(`Mengirim notifikasi ${artikel.length} artikel baru ke ${pelanggan.length} pelanggan aktif.`);
  let terkirim = 0, gagal = 0, batasHarian = false;
  for (const a of artikel) {
    if (batasHarian) break;
    const hasil = await kirimSatuArtikel({ artikel: a, pelanggan, resendApiKey: resendKey });
    terkirim += hasil.terkirim;
    gagal += hasil.gagal;
    if (hasil.batasHarian) batasHarian = true;
  }
  console.log(`Selesai: ${terkirim} terkirim, ${gagal} gagal${batasHarian ? ' (berhenti karena batas harian)' : ''}.`);
  return 0;
}

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().then((code) => { process.exitCode = code; }).catch((err) => {
    console.error(`FATAL: ${err.message}`);
    process.exitCode = 1;
  });
}
