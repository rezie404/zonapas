// Hitung titik fokus wajah tiap foto sampul — dijalankan SEBELUM
// `astro build` (lihat script "build" di package.json).
//
// Latar: kartu berita memakai kotak 16:9 + object-cover, jadi foto
// sampul potret tampil hanya sebagian (jendela tengah). Atas perintah
// Bos Besar (13 Nov 2026): foto TIDAK di-crop — thumbnail hanya
// "mengambil fokus" ke wajah orang terdepan secara otomatis. Caranya:
// script ini mencari jendela 16:9 yang memuat wajah terbanyak, lalu
// menulis titik fokusnya sebagai persentase object-position CSS ke
// src/data/fokus-wajah.json; NewsCard memasang nilai itu di <img>
// (style="object-position:X% Y%") sehingga jendela kartu menampilkan
// wajah orang terdepan — tanpa mengubah berkas foto sama sekali.
//
// Cara kerja (tanpa pustaka ML — deteksi wajah ML dicoba 13 Nov 2026:
// face-api/TensorFlow mengembalikan 0 wajah di foto-foto ini, sharp
// saliency malah mengarah ke papan nama): pindai kulit (aturan warna
// Kovac) pada salinan kecil 200px, kelompokkan piksel kulit jadi
// gumpalan seukuran wajah, lalu geser jendela 16:9 dan pilih yang
// skornya tertinggi (piksel kulit + 60 x jumlah gumpalan — gumpalan
// menangkal kursi rotan/panel kayu yang luas tapi bukan wajah; piksel
// menangkal maskot kartun yang terpecah jadi banyak gumpalan kecil).
// Gumpalan setipis teks judul emas (tinggi <= 5px pada salinan 200px)
// dibuang. Bila tidak ada wajah (< 3 gumpalan), foto tidak ditulis ke
// JSON — NewsCard memakai 50%/50% (tengah, seperti sekarang).
//
// Divalidasi visual 13 Nov 2026 pada 7 sampul (kunker, LPKA, senam,
// bakti, star, pahlawan, royong): semua wajah utuh di tengah jendela.
// Script ini TIDAK PERNAH menggagalkan build: bila pindai gagal, JSON
// lama dipertahankan dan build lanjut.
import { Jimp } from "jimp";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SUMBER = path.join(ROOT, "public", "images");
const KELUAR = path.join(ROOT, "src", "data", "fokus-wajah.json");
const RASIO = 16 / 9;
const BOBOT_GUMPAL = 60;
const LEWATI = /^(icon-|logo-|robot-|pasman|lambang-|dikuti-)/i;

function kulitKovac(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  return r > 95 && g > 40 && b > 20 && mx - mn > 15 && Math.abs(r - g) > 15 && r > g && r > b;
}

// Jendela 16:9 (dalam piksel gambar asli) yang memuat wajah terbanyak,
// atau null bila tidak ada wajah terdeteksi.
function cariJendelaWajah(gambar) {
  const W = gambar.bitmap.width;
  const H = gambar.bitmap.height;
  const kecil = gambar.clone().resize({ w: 200 });
  const { width: w, height: h, data } = kecil.bitmap;
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (kulitKovac(data[i], data[i + 1], data[i + 2])) mask[y * w + x] = 1;
    }
  }
  const label = new Int32Array(w * h).fill(-1);
  const komps = [];
  const tumpuk = [];
  for (let s = 0; s < w * h; s++) {
    if (!mask[s] || label[s] >= 0) continue;
    const id = komps.length;
    let minX = w, maxX = -1, minY = h, maxY = -1, luas = 0;
    tumpuk.push(s);
    label[s] = id;
    while (tumpuk.length) {
      const p = tumpuk.pop();
      const px = p % w, py = Math.floor(p / w);
      luas++;
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = px + dx, ny = py + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const q = ny * w + nx;
          if (mask[q] && label[q] < 0) { label[q] = id; tumpuk.push(q); }
        }
      }
    }
    komps.push({ minX, maxX, minY, maxY, luas });
  }
  const barisPiksel = new Array(h).fill(0);
  const kolomPiksel = new Array(w).fill(0);
  const barisGumpal = new Array(h).fill(0);
  const kolomGumpal = new Array(w).fill(0);
  let totalPiksel = 0, totalGumpal = 0, sx = 0, sy = 0;
  for (let k = 0; k < komps.length; k++) {
    const c = komps[k];
    const bw = c.maxX - c.minX + 1, bh = c.maxY - c.minY + 1;
    if (bw < 3 || bh < 6 || bw > 45 || bh > 45 || c.luas < 12 || c.luas > 900) continue;
    totalGumpal++;
    const cxp = Math.round((c.minX + c.maxX) / 2), cyp = Math.round((c.minY + c.maxY) / 2);
    barisGumpal[cyp]++;
    kolomGumpal[cxp]++;
    sx += cxp;
    sy += cyp;
    for (let y = c.minY; y <= c.maxY; y++) {
      for (let x = c.minX; x <= c.maxX; x++) {
        if (label[y * w + x] === k) { barisPiksel[y]++; kolomPiksel[x]++; totalPiksel++; }
      }
    }
  }
  if (totalGumpal < 3) return null;
  const cx = sx / totalGumpal / w, cy = sy / totalGumpal / h;
  const skorTotal = totalPiksel + BOBOT_GUMPAL * totalGumpal;
  if (W / H > RASIO) {
    const jh = H, jw = Math.round(H * RASIO);
    const jwK = Math.round(jw / W * w);
    let terbaik = -1, bx = 0;
    for (let x0 = 0; x0 + jwK <= w; x0 += 2) {
      let s = 0;
      for (let x = x0; x < x0 + jwK; x++) s += kolomPiksel[x] + BOBOT_GUMPAL * kolomGumpal[x];
      const tengah = (x0 + jwK / 2) / w;
      const skor = s - Math.abs(tengah - cx) * skorTotal * 0.05;
      if (skor > terbaik) { terbaik = skor; bx = x0; }
    }
    return { x: Math.round(bx / w * W), y: 0, w: jw, h: jh };
  }
  const jw = W, jh = Math.round(W / RASIO);
  const jhK = Math.round(jh / H * h);
  let terbaik = -1, by = 0;
  for (let y0 = 0; y0 + jhK <= h; y0 += 2) {
    let s = 0;
    for (let y = y0; y < y0 + jhK; y++) s += barisPiksel[y] + BOBOT_GUMPAL * barisGumpal[y];
    const tengah = (y0 + jhK / 2) / h;
    const skor = s - Math.abs(tengah - cy) * skorTotal * 0.05;
    if (skor > terbaik) { terbaik = skor; by = y0; }
  }
  return { x: 0, y: Math.round(by / h * H), w: jw, h: jh };
}

// Ubah jendela menjadi persentase object-position CSS.
// object-position p% membuat jendela mulai di p% x (lebar gambar - lebar
// jendela), jadi p = posisi jendela / ruang gerak x 100.
function keObjectPosition(jendela, W, H) {
  let x = 50, y = 50;
  if (W / H > RASIO) {
    const jw = Math.round(H * RASIO);
    const gerak = W - jw;
    if (gerak > 0) x = Math.round((jendela.x / gerak) * 1000) / 10;
  } else {
    const jh = Math.round(W / RASIO);
    const gerak = H - jh;
    if (gerak > 0) y = Math.round((jendela.y / gerak) * 1000) / 10;
  }
  return { x: Math.min(100, Math.max(0, x)), y: Math.min(100, Math.max(0, y)) };
}

try {
  if (!fs.existsSync(SUMBER)) {
    console.log("[fokus] public/images tidak ada — lewati hitung fokus wajah.");
    process.exit(0);
  }
  const berkas = fs
    .readdirSync(SUMBER)
    .filter((f) => /\.(jpg|jpeg|png)$/i.test(f) && !LEWATI.test(f));
  const hasil = {};
  let berwajah = 0;
  for (const nama of berkas) {
    try {
      const gambar = await Jimp.read(fs.readFileSync(path.join(SUMBER, nama)));
      const jendela = cariJendelaWajah(gambar);
      if (!jendela) continue;
      hasil[`/images/${nama}`] = keObjectPosition(jendela, gambar.bitmap.width, gambar.bitmap.height);
      berwajah++;
    } catch (err) {
      console.warn(`[fokus] pindai ${nama} gagal (${err.message}) — pakai tengah (50/50).`);
    }
  }
  fs.mkdirSync(path.dirname(KELUAR), { recursive: true });
  fs.writeFileSync(KELUAR, JSON.stringify(hasil, null, 2) + "\n");
  console.log(`[fokus] ${berwajah} dari ${berkas.length} sampul berfokus wajah → ${path.relative(ROOT, KELUAR)}.`);
} catch (err) {
  console.warn(`[fokus] hitung fokus wajah gagal (${err.message}) — JSON lama dipertahankan, build lanjut.`);
}
