// Watermark build ZonaPas — dijalankan SETELAH `astro build` (lihat script "build" di package.json).
//
// Memberi watermark logo ZonaPas pada SALINAN foto berita di dist/images,
// yaitu file yang disajikan situs zonapas.web.id. File sumber di public/images
// TIDAK PERNAH diubah, jadi setiap build dimulai dari foto bersih — tidak ada
// watermark ganda antar-build (idempotent).
//
// Kenapa di build, bukan di Decap CMS: Decap mengunggah media langsung ke GitHub
// tanpa hook server; setiap unggahan itu memicu rebuild Pages, sehingga script
// ini otomatis me-watermark SEMUA foto berita baru dari CMS (/admin) maupun dari
// Redaksi (yang sudah di-watermark sekali di canvas editor — geometri di sini
// SAMA PERSIS dengan canvas Redaksi: lebar logo 15% lebar foto, padding 2%,
// alpha 0,6, pojok kanan bawah — jadi pada foto Redaksi hanya opasitasnya
// sedikit menguat, tanpa bayangan ganda bergeser).
//
// BATASAN (jujur): file di repo GitHub (public/images/...) sendiri TIDAK
// ber-watermark; yang ber-watermark adalah salinan yang disajikan situs.
// Bila file mentah diunduh langsung dari GitHub, watermark tidak ikut.
//
// File yang TIDAK di-watermark (keputusan 04 Nov 2026):
// - logo itu sendiri (logo-zonapas.png, logo-zonapas-asli.jpg, logo-zonapas-nama.png).
// - foto JurnalPAS (jurnalpas-*.jpg): foto asli dari JurnalPAS, dibiarkan apa
//   adanya. Bila Bos Besar minta ikut di-watermark, hapus awalan "jurnalpas-"
//   dari SKIP_PREFIXES di bawah.
// - ilustrasi cover-*.svg / cover-default.svg tidak diproses (script hanya JPG/PNG).
import { Jimp } from "jimp";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const IMG_DIR = path.join(ROOT, "dist", "images");
const LOGO_FILE = "logo-zonapas-nama.png"; // watermark = wordmark ZonaPas (05 Nov 2026)

const SKIP_FILES = new Set(["logo-zonapas.png", "logo-zonapas-asli.jpg", "logo-zonapas-nama.png"]);
const SKIP_PREFIXES = ["jurnalpas-"];
const LOGO_FRACTION = 0.15; // lebar logo = 15% lebar foto
const LOGO_ALPHA = 0.6; // lebih transparan namun tetap terlihat
const PAD_FRACTION = 0.02; // jarak dari tepi = 2% lebar foto
const JPEG_QUALITY = 85;

if (!fs.existsSync(IMG_DIR)) {
  console.error(`[watermark] GAGAL: folder ${IMG_DIR} tidak ada. Jalankan setelah "astro build".`);
  process.exit(1);
}
const logoPath = path.join(IMG_DIR, LOGO_FILE);
if (!fs.existsSync(logoPath)) {
  console.error(`[watermark] GAGAL: ${LOGO_FILE} tidak ditemukan di dist/images — build dibatalkan.`);
  process.exit(1);
}
const logoBuf = fs.readFileSync(logoPath);
const files = fs
  .readdirSync(IMG_DIR)
  .filter(
    (f) =>
      /\.(jpe?g|png)$/i.test(f) &&
      !SKIP_FILES.has(f) &&
      !SKIP_PREFIXES.some((p) => f.startsWith(p)),
  );

let done = 0;
for (const file of files) {
  const full = path.join(IMG_DIR, file);
  try {
    const img = await Jimp.read(fs.readFileSync(full));
    const logo = await Jimp.read(logoBuf);
    const ww = Math.max(24, Math.round(img.width * LOGO_FRACTION));
    logo.resize({ w: ww });
    const pad = Math.round(img.width * PAD_FRACTION);
    img.composite(logo, img.width - ww - pad, img.height - logo.height - pad, {
      mode: Jimp.BLEND_SOURCE_OVER,
      opacitySource: LOGO_ALPHA,
    });
    if (/\.jpe?g$/i.test(file)) {
      await img.write(full, { quality: JPEG_QUALITY });
    } else {
      await img.write(full);
    }
    console.log(`[watermark] ${file} ${img.width}x${img.height} logo ${ww}px`);
    done++;
  } catch (err) {
    // Satu foto rusak tidak boleh menggagalkan seluruh build situs.
    console.error(`[watermark] LEWATI ${file}: ${err.message}`);
  }
}
console.log(`[watermark] selesai: ${done} foto diberi watermark, ${files.length - done} dilewati.`);
