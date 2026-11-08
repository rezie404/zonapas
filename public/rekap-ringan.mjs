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
