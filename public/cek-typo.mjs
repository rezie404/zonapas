// Cek typo bahasa Indonesia untuk Kelola Berita ZonaPas.
//
// Cara kerja: heuristik berbasis kamus (public/kamus-id.json, ~45 ribu kata
// dari hunspell-id + kosakata artikel ZonaPas) dan stemming ringan bahasa
// Indonesia. Kata yang tidak dikenal ditandai sebagai KEMUNGKINAN typo —
// bukan vonis: nama baru, istilah asing, atau kata yang belum ada di kamus
// bisa ikut tertandai, jadi penulis selalu bisa memilih "Tetap simpan".
//
// Modul ini dipakai dua arah:
//  - browser: dimuat lewat <script type="module" src="/cek-typo.mjs"> dan
//    diekspos sebagai window.__cekTypo (lihat penjaga window di bawah);
//  - node: diimpor langsung oleh scripts/cek-typo.test.mjs (fungsi murni,
//    tanpa DOM/fetch di level atas).

// Awalan umum + kemungkinan huruf awal kata dasarnya
// (mis. "menyapu" -> "sapu", "mengirim" -> "kirim", "memakai" -> "pakai").
const AWALAN = [
  ["meny", "s"], ["meng", "k"], ["menge", ""], ["men", "t"], ["mem", "p"],
  ["me", ""], ["peng", "k"], ["peny", "s"], ["pen", "t"], ["pem", "p"],
  ["pe", ""], ["ber", ""], ["ter", ""], ["di", ""], ["ke", ""], ["se", ""],
  ["per", ""], ["pel", ""],
];
const AKHIRAN = ["nya", "lah", "kah", "pun", "ku", "mu", "kan", "an", "i"];

function lepasAkhiran(kata) {
  const hasil = [];
  for (const ak of AKHIRAN) {
    if (kata.endsWith(ak) && kata.length - ak.length >= 3) {
      hasil.push(kata.slice(0, -ak.length));
    }
  }
  return hasil;
}

function lepasAwalan(kata) {
  const hasil = [];
  for (const [aw, ganti] of AWALAN) {
    if (kata.startsWith(aw) && kata.length - aw.length >= 3) {
      hasil.push(kata.slice(aw.length));
      if (ganti) hasil.push(ganti + kata.slice(aw.length));
    }
  }
  return hasil;
}

// True bila kata (sudah huruf kecil) ada di kamus, atau kata dasarnya ada
// setelah melepas satu awalan dan/atau satu akhiran. Kata ulang (tanda
// hubung) dikenal bila semua bagiannya dikenal.
export function kataDikenal(kata, kamus) {
  if (kamus.has(kata)) return true;
  if (kata.includes("-")) {
    return kata.split("-").every((b) => b.length >= 2 && kataDikenal(b, kamus));
  }
  const varian = new Set([kata]);
  for (const v of lepasAkhiran(kata)) varian.add(v);
  for (const v of lepasAwalan(kata)) varian.add(v);
  // Kombinasi: awalan + akhiran (mis. "pemasyarakatan" -> "masyarakat",
  // "dilaksanakan" -> "laksana", "kedatangan" -> "datang").
  for (const dasar of [...varian]) {
    for (const v of lepasAkhiran(dasar)) varian.add(v);
    for (const v of lepasAwalan(dasar)) varian.add(v);
  }
  for (const v of varian) if (kamus.has(v)) return true;
  return false;
}

// Ambil kata dari teks: buang tautan, email, dan penanda Markdown dulu.
export function tokenisasi(teks) {
  const bersih = String(teks || "")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/www\.\S+/g, " ")
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, " ")
    .replace(/[*_`#>\[\]()!]/g, " ");
  const daftar = [];
  const re = /[A-Za-zÀ-ÿ]+(?:-[A-Za-zÀ-ÿ]+)*/g;
  let m;
  while ((m = re.exec(bersih))) daftar.push({ kata: m[0], indeks: m.index });
  return daftar;
}

function konteks(teks, indeks, panjang) {
  const awal = Math.max(0, indeks - 28);
  const akhir = Math.min(teks.length, indeks + panjang + 28);
  let s = teks.slice(awal, akhir).replace(/\s+/g, " ");
  if (awal > 0) s = "…" + s;
  if (akhir < teks.length) s = s + "…";
  return s;
}

// Periksa satu teks; kembalikan daftar temuan {kata, konteks} — tiap kata
// yang dicurigai hanya muncul sekali (kemunculan pertama). Kata ulang
// diperiksa per bagian, jadi yang dilaporkan adalah bagian yang salah.
export function cekTypo(teks, kamus) {
  const temuan = [];
  const sudah = new Set();
  const periksa = (kata, indeks) => {
    const rendah = kata.toLowerCase();
    if (sudah.has(rendah)) return;
    if (kata.length < 2) return;
    if (/^[A-Z]{2,}$/.test(kata)) return; // singkatan: UPT, LPKA, IIA, ...
    if (kataDikenal(rendah, kamus)) return;
    sudah.add(rendah);
    temuan.push({ kata, konteks: konteks(teks, indeks, kata.length) });
  };
  for (const { kata, indeks } of tokenisasi(teks)) {
    if (kata.includes("-")) {
      let off = 0;
      for (const bagian of kata.split("-")) {
        periksa(bagian, indeks + off);
        off += bagian.length + 1;
      }
    } else {
      periksa(kata, indeks);
    }
  }
  return temuan;
}

// Periksa judul + isi sekaligus; tiap temuan membawa label bagiannya.
export function cekTypoGabungan(judul, isi, kamus) {
  const hasil = [];
  for (const t of cekTypo(judul, kamus)) hasil.push({ ...t, bagian: "Judul" });
  for (const t of cekTypo(isi, kamus)) hasil.push({ ...t, bagian: "Isi berita" });
  return hasil;
}

let kamusCache = null;

// Muat kamus dari situs (sekali saja, lalu di-cache). Gagal memuat = lempar
// error; pemanggil harus memperlakukan itu sebagai "lewati pemeriksaan",
// bukan sebagai penghalang menyimpan.
export async function muatKamus() {
  if (kamusCache) return kamusCache;
  const res = await fetch("/kamus-id.json");
  if (!res.ok) throw new Error("kamus gagal dimuat (" + res.status + ")");
  const data = await res.json();
  kamusCache = new Set(data.kata || []);
  return kamusCache;
}

// Ekspos untuk halaman Kelola Berita (script inline di sana memakai
// window.__cekTypo). Di node (pengujian) penjaga ini tidak berjalan.
if (typeof window !== "undefined") {
  window.__cekTypo = { kataDikenal, tokenisasi, cekTypo, cekTypoGabungan, muatKamus };
}
