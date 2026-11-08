// rekap-ringan.mjs — Hitung + penanggalan laporan Rekap (ZonaPas).
//
// Modul RINGAN yang dimuat halaman Rekap saat buka (untuk pratinjau +
// nama berkas). Pembangun DOCX/PDF yang berat ada di rekap-laporan.mjs
// dan dimuat MALAS (lazy) hanya saat pengguna mengunduh/mengirim laporan,
// supaya halaman pertama terbuka cepat seperti aplikasi Rekap di Jarvis.

export const REKAP_UPT_LAPORAN = ["Kanwil Ditjenpas Bengkulu", "Lapas Kelas IIA Bengkulu", "Lapas Kelas IIA Curup", "Lapas Kelas IIB Arga Makmur", "Lapas Perempuan Kelas IIB Bengkulu", "Bapas Kelas I Bengkulu", "LPKA Kelas II Bengkulu", "Rutan Kelas IIB Bengkulu", "Rutan Kelas IIB Manna"];
export const REKAP_JUDUL_KOSONG = "Publikasi (tanpa judul di laporan)";

// Nama UPT seperti tertulis di DOKUMEN laporan (template): Kanwil ditulis
// lengkap "Kantor Wilayah Direktorat Jenderal Pemasyarakatan Bengkulu"
// di tabel rekapitulasi + judul rincian; 8 UPT lain sama dengan nama baku.
export const NAMA_LAPORAN = { "Kanwil Ditjenpas Bengkulu": "Kantor Wilayah Direktorat Jenderal Pemasyarakatan Bengkulu" };
export function namaLaporan(upt) { return NAMA_LAPORAN[upt] || upt; }

const HARI_ID = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
const BULAN_ID = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

export function tanggalIndonesia(iso) {
  const [y, m, d] = String(iso || "").split("-").map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  return `${HARI_ID[dt.getUTCDay()]}, ${d} ${BULAN_ID[(m || 1) - 1]} ${y}`;
}
export function tanggalIndonesiaTanpaHari(iso) {
  const [y, m, d] = String(iso || "").split("-").map(Number);
  return `${d} ${BULAN_ID[(m || 1) - 1]} ${y}`;
}
export function namaFileLaporan(tanggal, ext) {
  const [y, m, d] = String(tanggal || "");
  return `${d}_${m}_${y}_Laporan_Publikasi_Harian_Kanwil_Ditjenpas_Bengkulu.${ext}`;
}

// Hitung rekap per UPT dari rows + penanda nihil. Judul di laporan adalah
// judul UNIK per UPT (urutan kemunculan pertama); tautan = semua baris.
export function hitungRekap(data) {
  const tanggal = data.tanggal || data.date || "";
  const rows = (data.rows || []).filter((r) => !tanggal || !r.tanggal || r.tanggal === tanggal);
  const nihilSet = new Set((data.nihil || []).map((n) => (typeof n === "string" ? n : n.upt)));
  const perUpt = REKAP_UPT_LAPORAN.map((nama) => {
    const rs = rows.filter((r) => r.upt === nama);
    const sosial = rs.filter((r) => r.platform !== "Website / Media Online").length;
    const massa = rs.length - sosial;
    const judulUnik = [];
    for (const r of rs) {
      const j = String(r.judul || "").trim() || REKAP_JUDUL_KOSONG;
      if (!judulUnik.includes(j)) judulUnik.push(j);
    }
    return { nama, rows: rs, sosial, massa, jumlah: rs.length, nihil: rs.length === 0 && nihilSet.has(nama), judul: rs.length ? judulUnik : ["Nihil"], tautan: rs.length ? rs.map((r) => r.url) : ["Nihil"] };
  });
  const total = perUpt.reduce((a, u) => ({ sosial: a.sosial + u.sosial, massa: a.massa + u.massa, jumlah: a.jumlah + u.jumlah }), { sosial: 0, massa: 0, jumlah: 0 });
  return { tanggal, perUpt, total };
}

// ---------- Pratinjau laporan lengkap (seperti aplikasi Rekap di Jarvis) ----------
// Teks statis diambil dari template laporan kiriman Bos Besar (08 Nov 2026);
// hanya tanggal, jumlah, dan rincian yang diisi dari data. Isi pratinjau
// ini SAMA dengan isi DOCX/PDF (kop, judul, A–D, tanda tangan).
function escHtml(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const TEKS_PENDAHULUAN = "Dalam rangka mendukung keterbukaan informasi publik serta penyebarluasan informasi mengenai pelaksanaan tugas dan fungsi pemasyarakatan kepada masyarakat, diperlukan publikasi yang informatif, aktual, dan berkesinambungan melalui media sosial maupun media massa. Sehubungan dengan hal tersebut, Kantor Wilayah Direktorat Jenderal Pemasyarakatan Bengkulu melaksanakan pendataan dan rekapitulasi harian terhadap hasil rilis dan publikasi yang dilakukan oleh Kantor Wilayah dan seluruh Unit Pelaksana Teknis Pemasyarakatan di lingkungan Kantor Wilayah Direktorat Jenderal Pemasyarakatan Bengkulu.";
const TEKS_UMUM = "Publikasi merupakan salah satu instrumen strategis dalam membangun kepercayaan publik terhadap kinerja Pemasyarakatan. Melalui publikasi yang cepat, akurat, dan humanis, masyarakat dapat mengetahui secara langsung berbagai kegiatan pembinaan, pelayanan, pengamanan, serta kisah inspiratif Warga Binaan di seluruh Unit Pelaksana Teknis (UPT) Pemasyarakatan di lingkungan Kantor Wilayah Direktorat Jenderal Pemasyarakatan Bengkulu.";
const TEKS_MAKSUD = "Penyusunan Laporan ini dimaksudkan sebagai bentuk keterbukaan informasi publik dan akuntabilitas kinerja instansi/organisasi dalam menyebarluaskan capaian program, kebijakan, serta aktivitas strategis yang telah dilaksanakan kepada pemangku kepentingan (stakeholders) dan masyarakat luas. Adapun tujuan dari penyusunan dan penerbitan Laporan Publikasi ini adalah:";
const TEKS_TUJUAN = [
  "Menyajikan gambaran secara objektif, sistematis, dan transparan mengenai hasil pelaksanaan tugas, fungsi, serta program kerja.",
  "Menjadi sarana evaluasi dan bentuk pertanggungjawaban publik atas penggunaan sumber daya dan pelaksanaan kebijakan organisasi.",
  "Memperkuat komunikasi publik guna membangun pemahaman, dukungan, serta kepercayaan masyarakat terhadap instansi/organisasi.",
  "Bahan Evaluasi dan Pengambilan Kebijakan: Menyediakan data serta dokumen rujukan bagi perbaikan pelaksanaan program dan perumusan strategi pada periode berikutnya.",
];
const TEKS_RUANG_LINGKUP = "Ruang lingkup laporan ini meliputi pendataan, rekapitulasi, dan rincian hasil rilis serta publikasi media sosial dan media massa yang dilaksanakan oleh Kantor Wilayah dan Unit Pelaksana Teknis Pemasyarakatan di lingkungan Kantor Wilayah Direktorat Jenderal Pemasyarakatan Bengkulu pada";
const TEKS_KEGIATAN = [
  "Kegiatan yang dilaksanakan berupa pengumpulan, pendataan, dan rekapitulasi hasil rilis serta publikasi yang dilakukan oleh Kantor Wilayah dan Unit Pelaksana Teknis Pemasyarakatan di lingkungan Kantor Wilayah Direktorat Jenderal Pemasyarakatan Bengkulu melalui media sosial dan media massa.",
  "Pendataan dilakukan terhadap sembilan satuan kerja, yang terdiri atas Kantor Wilayah Direktorat Jenderal Pemasyarakatan Bengkulu, Lapas Kelas IIA Bengkulu, Lapas Kelas IIA Curup, Lapas Kelas IIB Arga Makmur, Lapas Perempuan Kelas IIB Bengkulu, Bapas Kelas I Bengkulu, LPKA Kelas II Bengkulu, Rutan Kelas IIB Bengkulu, dan Rutan Kelas IIB Manna.",
  "Selanjutnya, dilakukan penghitungan jumlah publikasi pada masing-masing satuan kerja serta pencatatan judul dan tautan publikasi sebagai bahan dokumentasi dan pemantauan hasil publikasi harian.",
];
const TEKS_PENUTUP = [
  "Demikian laporan pelaksanaan pendataan dan rekapitulasi hasil rilis dan publikasi media sosial serta media massa pada Kantor Wilayah dan Unit Pelaksana Teknis Pemasyarakatan di lingkungan Kantor Wilayah Direktorat Jenderal Pemasyarakatan Bengkulu ini disusun sebagai bentuk dokumentasi dan bahan monitoring pelaksanaan publikasi harian.",
  "Atas perhatian dan kerja sama seluruh pihak, disampaikan terima kasih.",
];

// Bangun HTML pratinjau laporan lengkap dari hasil hitungRekap().
// Logo kop diambil dari berkas template laporan (image1.jpeg).
export function pratinjauLaporanHtml(hitung) {
  const t = hitung.total || { sosial: 0, massa: 0, jumlah: 0 };
  const tgl = hitung.tanggal || "";
  const tglPanjang = tanggalIndonesia(tgl);
  const tglSingkat = tanggalIndonesiaTanpaHari(tgl);
  let h = '<div class="pratinjau-dokumen">';
  // Kop
  h += '<div class="kop"><img src="/template-laporan/word/media/image1.jpeg" alt="Logo Kementerian Imigrasi dan Pemasyarakatan" onerror="this.style.display=\'none\'" /><div class="kop-teks"><p>KEMENTERIAN IMIGRASI DAN PEMASYARAKATAN REPUBLIK INDONESIA</p><p>DIREKTORAT JENDERAL PEMASYARAKATAN</p><p>KANTOR WILAYAH BENGKULU</p><p class="alamat">Jl. Batang Hari No.17, Kec. Ratu Agung, Kota Bengkulu</p><p class="alamat">Pos-el : bengkuluditjenpas@gmail.com</p></div></div>';
  // Judul laporan
  h += '<div class="judul-laporan"><p>LAPORAN</p><p>TENTANG</p><p>DATA HARIAN HASIL RILIS DAN PUBLIKASI MEDIA SOSIAL</p><p>UNIT PELAKSANA TEKNIS PEMASYARAKATAN DI LINGKUNGAN</p><p>KANTOR WILAYAH DIREKTORAT JENDERAL PEMASYARAKATAN BENGKULU</p></div>';
  // A. PENDAHULUAN
  h += '<h3>A. PENDAHULUAN</h3>';
  h += '<p>' + escHtml(TEKS_PENDAHULUAN) + '</p>';
  h += '<h4>1. Umum</h4><p>' + escHtml(TEKS_UMUM) + '</p>';
  h += '<h4>2. Maksud dan Tujuan</h4><p>' + escHtml(TEKS_MAKSUD) + '</p>';
  h += '<ol class="tujuan">' + TEKS_TUJUAN.map((x) => '<li>' + escHtml(x) + '</li>').join('') + '</ol>';
  h += '<h4>3. Ruang Lingkup</h4><p>' + escHtml(TEKS_RUANG_LINGKUP) + '</p>';
  h += '<p class="ruang">\u2022 Hari/tanggal : ' + escHtml(tglPanjang) + '</p>';
  h += '<p class="ruang">\u2022 Pukul : 20.00 WIB</p>';
  // B. KEGIATAN YANG DILAKSANAKAN
  h += '<h3>B. KEGIATAN YANG DILAKSANAKAN</h3>';
  h += TEKS_KEGIATAN.map((x) => '<p>' + escHtml(x) + '</p>').join('');
  // C. HASIL YANG DICAPAI
  h += '<h3>C. HASIL YANG DICAPAI</h3>';
  h += '<h4>1. Rekapitulasi Publikasi</h4>';
  h += '<p>Jumlah publikasi pada hari pelaporan adalah sebagai berikut:</p>';
  h += '<p class="ruang">Media Sosial : ' + t.sosial + ' publikasi</p>';
  h += '<p class="ruang">Media Massa : ' + t.massa + ' publikasi</p>';
  h += '<p class="ruang">Jumlah : ' + t.jumlah + ' publikasi</p>';
  h += '<p>Rincian jumlah publikasi per satuan kerja disajikan dalam tabel berikut:</p>';
  h += '<div class="gulir"><table><thead><tr><th>No.</th><th>Satuan Kerja</th><th class="angka">Media Sosial</th><th class="angka">Media Massa</th><th class="angka">Jumlah</th></tr></thead><tbody>';
  h += hitung.perUpt.map((u, i) => '<tr><td>' + (i + 1) + '</td><td>' + escHtml(namaLaporan(u.nama)) + '</td><td class="angka">' + u.sosial + '</td><td class="angka">' + u.massa + '</td><td class="angka">' + u.jumlah + '</td></tr>').join('');
  h += '<tr class="jumlah"><td></td><td>JUMLAH</td><td class="angka">' + t.sosial + '</td><td class="angka">' + t.massa + '</td><td class="angka">' + t.jumlah + '</td></tr>';
  h += '</tbody></table></div>';
  h += '<h4>2. Rincian Publikasi Per Satuan Kerja</h4>';
  hitung.perUpt.forEach((u, i) => {
    h += '<h4>' + (i + 1) + ') ' + escHtml(namaLaporan(u.nama)) + '</h4>';
    h += '<p>a. Media Sosial : ' + u.sosial + ' publikasi</p>';
    h += '<p>b. Media Massa : ' + u.massa + ' publikasi</p>';
    // UPT nihil ditulis sebaris di labelnya (seperti DOCX/PDF), tanpa daftar.
    if (u.judul.length === 1 && u.judul[0] === 'Nihil') {
      h += '<p>c. Judul Publikasi : Nihil</p>';
    } else {
      h += '<p>c. Judul Publikasi :</p>';
      h += '<ol class="daftar">' + u.judul.map((j) => '<li>' + escHtml(j) + '</li>').join('') + '</ol>';
    }
    if (u.tautan.length === 1 && u.tautan[0] === 'Nihil') {
      h += '<p>d. Tautan Publikasi : Nihil</p>';
    } else {
      h += '<p>d. Tautan Publikasi :</p>';
      h += '<ol class="daftar">' + u.tautan.map((ta) => '<li><a href="' + escHtml(ta) + '" target="_blank" rel="noopener">' + escHtml(ta) + '</a></li>').join('') + '</ol>';
    }
  });
  // D. PENUTUP
  h += '<h3>D. PENUTUP</h3>';
  h += TEKS_PENUTUP.map((x) => '<p>' + escHtml(x) + '</p>').join('');
  h += '<div class="tanda-tangan"><p>Bengkulu, ' + escHtml(tglSingkat) + '</p><p>Kepala Kantor Wilayah,</p><p>ttd</p><p><strong>MASJUNO</strong></p></div>';
  h += '</div>';
  return h;
}
