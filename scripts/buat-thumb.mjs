// Buat thumbnail kecil foto sampul artikel — dijalankan SETELAH
// `astro build` + watermark (lihat script "build" di package.json).
//
// Kenapa di akhir build: sumbernya adalah salinan foto di dist/images
// yang SUDAH di-watermark (jadi thumbnail ikut ber-watermark seperti foto
// aslinya), dan semua sampul baru — termasuk yang diunggah lewat Decap
// CMS langsung ke GitHub — otomatis mendapat thumbnail di setiap rebuild
// Pages tanpa langkah manual.
//
// Keluaran: dist/images/thumbs/<nama>-320.jpg (daftar kecil, w-28) dan
// <nama>-640.jpg (kartu sedang + hasil pencarian). URL-nya dipakai lewat
// thumbCover() di src/data/site.ts. Thumbnail TIDAK masuk repo — hanya
// ada di hasil build; BILA script ini gagal (mis. Jimp bermasalah),
// build TIDAK digagalkan: kartu fallback ke foto sampul asli lewat
// onerror (cover-default.svg) — jadi kegagalan di sini tidak pernah
// merobohkan deploy.
import { Jimp } from "jimp";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "images");
const KELUAR = path.join(DIST, "thumbs");
const UKURAN = [320, 640];
const KUALITAS = 72;

try {
  if (!fs.existsSync(DIST)) {
    console.log("[thumb] dist/images tidak ada — lewati pembuatan thumbnail.");
    process.exit(0);
  }
  fs.mkdirSync(KELUAR, { recursive: true });
  const berkas = fs.readdirSync(DIST).filter((f) => /^cover-[^/]+\.(jpg|jpeg|png)$/i.test(f));
  let dibuat = 0;
  for (const nama of berkas) {
    const dasar = nama.replace(/\.(jpg|jpeg|png)$/i, "");
    const asal = path.join(DIST, nama);
    for (const lebar of UKURAN) {
      const tujuan = path.join(KELUAR, `${dasar}-${lebar}.jpg`);
      try {
        if (fs.existsSync(tujuan) && fs.statSync(tujuan).mtimeMs >= fs.statSync(asal).mtimeMs) continue;
        const gambar = await Jimp.read(fs.readFileSync(asal));
        gambar.resize({ w: lebar });
        await gambar.write(tujuan, { quality: KUALITAS });
        dibuat++;
      } catch (err) {
        console.warn(`[thumb] gagal membuat ${path.basename(tujuan)}: ${err.message}`);
      }
    }
  }
  console.log(`[thumb] ${dibuat} thumbnail dibuat/diperbarui dari ${berkas.length} sampul.`);
} catch (err) {
  console.warn(`[thumb] pembuatan thumbnail gagal (${err.message}) — deploy tetap lanjut dengan foto asli.`);
}
