// rekap-laporan.mjs — Pembangun laporan Rekap Publikasi Harian UPT (ZonaPas).
//
// Dipakai halaman /portal/aplikasi-pendukung/app-rekap-publish/ :
//   const { buildDocx, buildPdf } = await import('/rekap-laporan.mjs');
//   const docx = await buildDocx(data);   // -> Blob DOCX
//   const pdf  = await buildPdf(data);    // -> Blob PDF
//   data = { tanggal: 'YYYY-MM-DD', rows: [{tanggal, upt, judul, platform, url}],
//            nihil: ['Bapas Kelas I Bengkulu'] | [{tanggal, upt}] }
// Kirim WA: unggah blob ke POST /redaksi/api/rekap/file lalu buka
//   https://api.whatsapp.com/send?text=<pesan berisi tautan unduh>
// Tautan unduh: https://zonapas.web.id/redaksi/api/rekap/file?token=<token>
//
// DOCX memakai TEMPLATE berkas laporan terkirim 8 Nov 2026 (dibangun
// generator resmi aplikasi Rekap Jarvis; Bos Besar minta dipakai sebagai
// template ZonaPas 8 Nov 2026) yang dipecah jadi bagian-bagian di
// public/template-laporan/. buildDocx TIDAK membangun XML dari nol: ia
// memuat document.xml template lalu mengganti HANYA data-nya — tanggal
// (Ruang Lingkup + tanda tangan), 3 angka rekapitulasi, sel angka tabel
// 11x5, angka a./b. tiap UPT, dan daftar judul/tautan tiap UPT. Semua teks
// lain, gaya, spasi, logo, dan struktur persis template. Template ini
// sudah TIDAK mengandung placeholder "[Sebutkan Periode/Tahun]" (yang
// ada di template lama -2 dan ikut tercetak di laporan 4-8 Nov 2026).
// Tautan di template berupa RELASI hyperlink Word (<w:hyperlink r:id> +
// entri di word/_rels/document.xml.rels), jadi setiap tautan baru perlu
// relasi baru (dibuat buildDocx; rId lanjut dari yang terbesar di template).
// UPT nihil ditulis SEBARIS di labelnya ("c. Judul Publikasi : Nihil",
// "d. Tautan Publikasi : Nihil"), tanpa butir bernomor terpisah — sama
// seperti berkas terkirim.
// PDF dibuat dengan mengonversi berkas DOCX (bukan digambar ulang oleh
// builder terpisah), supaya tampilannya persis sama dengan Word. Alur:
// buildDocx -> render DOCX ke HTML (docx-preview) -> HTML ke PDF
// (html2pdf.js = html2canvas + jsPDF). Pustaka dimuat lewat <script> (UMD)
// dari CDN jsDelivr — JANGAN pakai import() ESM (+esm) karena versi ESM
// html2pdf.js rusak (jspdf-plugin menyetel getPageSize pada undefined);
// docx-preview UMD butuh JSZip global dimuat dulu. Hasil konversi berupa
// gambar per halaman (teks tidak bisa dipilih), tetapi tampilannya sama
// persis dengan Word. Bila konversi gagal (mis. CDN tidak terjangkau),
// jatuh ke builder lama (buildPdfLegacy, tanpa dependensi) supaya PDF
// tetap bisa diunduh/dikirim. Garis ganda di bawah kop dan penulisan nihil
// sebaris mengikuti berkas PDF terkirim.
// Modul ini dimuat MALAS (lazy) oleh halaman — hanya saat mengunduh
// atau mengirim laporan — supaya halaman pertama terbuka cepat.
//
// Catatan fidelity (jujur):
//  - PDF memakai font inti Helvetica/Helvetica-Bold, bukan Arial: Arial
//    tidak tersedia sebagai file font yang bisa ditanam; Helvetica adalah
//    pengganti metrik-nya (lebar huruf hampir identik; di Linux ter-render
//    sebagai Liberation Sans, sama seperti PDF 5/6 Nov 2026 dari aplikasi
//    Rekap lama yang memakai "Arial 11 (ter-render Liberation Sans)").
//  - PDF tidak memakai penomoran halaman / header-footer: template DOCX
//    juga tidak punya nomor halaman maupun header/footer.
//  - Karakter di luar WinAnsi (mis. emoji di judul) dihilangkan di PDF
//    (DOCX mempertahankannya). Tanda baca umum (• – — " " … é) dipetakan.
//  - docProps/app.xml template (jumlah kata/halaman) dibiarkan apa adanya;
//    Word/WPS menghitung ulang saat berkas dibuka.

import { hitungRekap, namaLaporan, tanggalIndonesia, tanggalIndonesiaTanpaHari } from "./rekap-ringan.mjs";

function escXml(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ---------- ZIP (entri stored) ----------
const CRC_TABEL = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(u8) {
  let c = 0xffffffff;
  for (let i = 0; i < u8.length; i++) c = CRC_TABEL[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function zipStored(files) {
  // files: [[nama, Uint8Array|string]] — entri stored (tanpa kompresi).
  const enc = new TextEncoder();
  const lokal = [];
  const sentral = [];
  let offset = 0;
  for (const [nama, isi] of files) {
    const namaB = enc.encode(nama);
    const data = typeof isi === "string" ? enc.encode(isi) : isi;
    const crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);
    lh.setUint16(4, 20, true);
    lh.setUint16(6, 0x0800, true); // nama file UTF-8
    lh.setUint16(8, 0, true);
    lh.setUint16(10, 0, true);
    lh.setUint16(12, 0, true);
    lh.setUint32(14, crc, true);
    lh.setUint32(18, data.length, true);
    lh.setUint32(22, data.length, true);
    lh.setUint16(26, namaB.length, true);
    lh.setUint16(28, 0, true);
    lokal.push(lh.buffer, namaB, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true);
    ch.setUint16(4, 20, true);
    ch.setUint16(6, 20, true);
    ch.setUint16(8, 0x0800, true);
    ch.setUint16(10, 0, true);
    ch.setUint16(12, 0, true);
    ch.setUint16(14, 0, true);
    ch.setUint32(16, crc, true);
    ch.setUint32(20, data.length, true);
    ch.setUint32(24, data.length, true);
    ch.setUint16(28, namaB.length, true);
    ch.setUint16(30, 0, true);
    ch.setUint16(32, 0, true);
    ch.setUint16(34, 0, true);
    ch.setUint16(36, 0, true);
    ch.setUint32(38, 0, true);
    ch.setUint32(42, offset, true);
    sentral.push(ch.buffer, namaB);
    offset += 30 + namaB.length + data.length;
  }
  const awalSentral = offset;
  let ukuranSentral = 0;
  for (const b of sentral) ukuranSentral += b.byteLength;
  const akhir = new DataView(new ArrayBuffer(22));
  akhir.setUint32(0, 0x06054b50, true);
  akhir.setUint16(4, 0, true);
  akhir.setUint16(6, 0, true);
  akhir.setUint16(8, files.length, true);
  akhir.setUint16(10, files.length, true);
  akhir.setUint32(12, ukuranSentral, true);
  akhir.setUint32(16, awalSentral, true);
  akhir.setUint16(20, 0, true);
  const bagian = [...lokal, ...sentral, akhir.buffer];
  const total = bagian.reduce((a, b) => a + b.byteLength, 0);
  const out = new Uint8Array(total);
  let p = 0;
  for (const b of bagian) { out.set(new Uint8Array(b), p); p += b.byteLength; }
  return out;
}

// ---------- Teks laporan (dipakai PDF; DOCX mengambilnya dari template) ----------
const TEKS_PENDAHULUAN = "Dalam rangka mendukung keterbukaan informasi publik serta penyebarluasan informasi mengenai pelaksanaan tugas dan fungsi pemasyarakatan kepada masyarakat, diperlukan publikasi yang informatif, aktual, dan berkesinambungan melalui media sosial maupun media massa. Sehubungan dengan hal tersebut, Kantor Wilayah Direktorat Jenderal Pemasyarakatan Bengkulu melaksanakan pendataan dan rekapitulasi harian terhadap hasil rilis dan publikasi yang dilakukan oleh Kantor Wilayah dan seluruh Unit Pelaksana Teknis Pemasyarakatan di lingkungan Kantor Wilayah Direktorat Jenderal Pemasyarakatan Bengkulu.";
const TEKS_UMUM = "Publikasi merupakan salah satu instrumen strategis dalam membangun kepercayaan publik terhadap kinerja Pemasyarakatan. Melalui publikasi yang cepat, akurat, dan humanis, masyarakat dapat mengetahui secara langsung berbagai kegiatan pembinaan, pelayanan, pengamanan, serta kisah inspiratif Warga Binaan di seluruh Unit Pelaksana Teknis (UPT) Pemasyarakatan di lingkungan Kantor Wilayah Direktorat Jenderal Pemasyarakatan Bengkulu.";
const TEKS_MAKSUD = "Penyusunan Laporan ini dimaksudkan sebagai bentuk keterbukaan informasi publik dan akuntabilitas kinerja instansi/organisasi dalam menyebarluaskan capaian program, kebijakan, serta aktivitas strategis yang telah dilaksanakan kepada pemangku kepentingan (stakeholders) dan masyarakat luas. Adapun tujuan dari penyusunan dan penerbitan Laporan Publikasi ini adalah:";
const TUJUAN = [
  "Menyajikan gambaran secara objektif, sistematis, dan transparan mengenai hasil pelaksanaan tugas, fungsi, serta program kerja.",
  "Menjadi sarana evaluasi dan bentuk pertanggungjawaban publik atas penggunaan sumber daya dan pelaksanaan kebijakan organisasi.",
  "Memperkuat komunikasi publik guna membangun pemahaman, dukungan, serta kepercayaan masyarakat terhadap instansi/organisasi.",
  "Bahan Evaluasi dan Pengambilan Kebijakan: Menyediakan data serta dokumen rujukan bagi perbaikan pelaksanaan program dan perumusan strategi pada periode berikutnya.",
];
const TEKS_RUANG_LINGKUP = "Ruang lingkup laporan ini meliputi pendataan, rekapitulasi, dan rincian hasil rilis serta publikasi media sosial dan media massa yang dilaksanakan oleh Kantor Wilayah dan Unit Pelaksana Teknis Pemasyarakatan di lingkungan Kantor Wilayah Direktorat Jenderal Pemasyarakatan Bengkulu pada";
const TEKS_KEGIATAN_1 = "Kegiatan yang dilaksanakan berupa pengumpulan, pendataan, dan rekapitulasi hasil rilis serta publikasi yang dilakukan oleh Kantor Wilayah dan Unit Pelaksana Teknis Pemasyarakatan di lingkungan Kantor Wilayah Direktorat Jenderal Pemasyarakatan Bengkulu melalui media sosial dan media massa.";
const TEKS_KEGIATAN_2 = "Pendataan dilakukan terhadap sembilan satuan kerja, yang terdiri atas Kantor Wilayah Direktorat Jenderal Pemasyarakatan Bengkulu, Lapas Kelas IIA Bengkulu, Lapas Kelas IIA Curup, Lapas Kelas IIB Arga Makmur, Lapas Perempuan Kelas IIB Bengkulu, Bapas Kelas I Bengkulu, LPKA Kelas II Bengkulu, Rutan Kelas IIB Bengkulu, dan Rutan Kelas IIB Manna.";
const TEKS_KEGIATAN_3 = "Selanjutnya, dilakukan penghitungan jumlah publikasi pada masing-masing satuan kerja serta pencatatan judul dan tautan publikasi sebagai bahan dokumentasi dan pemantauan hasil publikasi harian.";
const TEKS_PENUTUP_1 = "Demikian laporan pelaksanaan pendataan dan rekapitulasi hasil rilis dan publikasi media sosial serta media massa pada Kantor Wilayah dan Unit Pelaksana Teknis Pemasyarakatan di lingkungan Kantor Wilayah Direktorat Jenderal Pemasyarakatan Bengkulu ini disusun sebagai bentuk dokumentasi dan bahan monitoring pelaksanaan publikasi harian.";
const TEKS_PENUTUP_2 = "Atas perhatian dan kerja sama seluruh pihak, disampaikan terima kasih.";

// ---------- DOCX: merge data ke template kiriman Bos Besar ----------
// Template dipecah jadi bagian-bagian di public/template-laporan/.
// Bagian teks dimuat sebagai teks, gambar sebagai biner; dimuat sekali
// lalu di-cache (modul dimuat malas, jadi unduhan pertama yang memuatnya).
const TEMPLATE_DASAR = "/template-laporan/";
const TEMPLATE_BAGIAN_TEKS = ["Content_Types.xml", "_rels/.rels", "docProps/core.xml", "word/document.xml", "word/_rels/document.xml.rels"];
const TEMPLATE_BAGIAN_BINER = ["word/media/image1.jpeg"];
// Tanggal yang tertulis di template (8 Nov 2026) — dipakai untuk
// memperbarui judul di docProps/core.xml.
const TEMPLATE_TANGGAL_SINGKAT = "8 November 2026";

let _templateCache = null;
async function muatTemplate() {
  if (_templateCache) return _templateCache;
  const teks = {};
  await Promise.all(TEMPLATE_BAGIAN_TEKS.map(async (n) => {
    const r = await fetch(TEMPLATE_DASAR + n);
    if (!r.ok) throw new Error("Template laporan tidak dapat dimuat (" + n + ").");
    teks[n] = await r.text();
  }));
  const biner = {};
  await Promise.all(TEMPLATE_BAGIAN_BINER.map(async (n) => {
    const r = await fetch(TEMPLATE_DASAR + n);
    if (!r.ok) throw new Error("Template laporan tidak dapat dimuat (" + n + ").");
    biner[n] = new Uint8Array(await r.arrayBuffer());
  }));
  _templateCache = { teks, biner };
  return _templateCache;
}

// Teks sebuah paragraf: gabungan semua <w:t> (instrText field HYPERLINK
// tidak ikut, supaya "HYPERLINK ..." tidak mengacaukan pencocokan).
function teksParagraf(xmlParagraf) {
  const tanpaInstr = String(xmlParagraf).replace(/<w:instrText[^>]*>[\s\S]*?<\/w:instrText>/g, "");
  const cocok = [...tanpaInstr.matchAll(/<w:t(?:\s[^>]*)?>(.*?)<\/w:t>/g)];
  return cocok.map((m) => m[1]).join("");
}
// Ganti isi <w:t> TERAKHIR di sebuah paragraf (atribut tag dipertahankan).
function gantiTeksTerakhir(xmlParagraf, teksBaru) {
  const semua = [...String(xmlParagraf).matchAll(/<w:t(?:\s[^>]*)?>(.*?)<\/w:t>/g)];
  if (!semua.length) return xmlParagraf;
  const terakhir = semua[semua.length - 1];
  const awal = terakhir.index, akhir = awal + terakhir[0].length;
  const buka = terakhir[0].slice(0, terakhir[0].indexOf(">") + 1);
  return xmlParagraf.slice(0, awal) + buka + escXml(teksBaru) + "</w:t>" + xmlParagraf.slice(akhir);
}
// Ganti isi <w:t> PERTAMA di sebuah paragraf (nomor butir "1.").
function gantiTeksPertama(xmlParagraf, teksBaru) {
  const semua = [...String(xmlParagraf).matchAll(/<w:t(?:\s[^>]*)?>(.*?)<\/w:t>/g)];
  if (!semua.length) return xmlParagraf;
  const pertama = semua[0];
  const awal = pertama.index, akhir = awal + pertama[0].length;
  const buka = pertama[0].slice(0, pertama[0].indexOf(">") + 1);
  return xmlParagraf.slice(0, awal) + buka + escXml(teksBaru) + "</w:t>" + xmlParagraf.slice(akhir);
}
// Hapus w14:paraId dari paragraf kloning (Word/WPS memberi yang baru;
// paraId ganda bisa membingungkan Word).
function tanpaParaId(xmlParagraf) {
  return String(xmlParagraf).replace(/\s+w14:paraId="[^"]*"/, "");
}

// Isi sel angka tabel rekapitulasi (11 baris x 5 kolom): baris 1-9 per UPT,
// baris 10 JUMLAH. Sel 0 (No.) dan sel 1 (nama) tidak diubah.
function isiTabelRekap(xmlTabel, perUpt, total) {
  const perNama = new Map(perUpt.map((u) => [namaLaporan(u.nama), u]));
  const baris = xmlTabel.match(/<w:tr[\s>][\s\S]*?<\/w:tr>/g) || [];
  const barisBaru = baris.map((br) => {
    const sel = br.match(/<w:tc>[\s\S]*?<\/w:tc>/g) || [];
    if (sel.length < 5) return br;
    const namaSel = teksParagraf(sel[1]);
    let angka = null;
    if (namaSel === "JUMLAH") angka = [total.sosial, total.massa, total.jumlah];
    else {
      const u = perNama.get(namaSel);
      if (!u) return br;
      angka = [u.sosial, u.massa, u.jumlah];
    }
    const selBaru = sel.map((c, i) => (i < 2 ? c : gantiTeksTerakhir(c, String(angka[i - 2]))));
    let j = 0;
    return br.replace(/<w:tc>[\s\S]*?<\/w:tc>/g, () => selBaru[j++]);
  });
  let k = 0;
  return xmlTabel.replace(/<w:tr[\s>][\s\S]*?<\/w:tr>/g, () => barisBaru[k++]);
}

// Ganti data di paragraf biasa (di luar rincian): tanggal Ruang Lingkup,
// 3 angka rekapitulasi, dan tanggal tanda tangan (di tabel tanda tangan).
function gantiDataParagraf(xmlParagraf, ctx) {
  const t = teksParagraf(xmlParagraf);
  if (t.startsWith("• Hari/tanggal")) return gantiTeksTerakhir(xmlParagraf, ": " + ctx.tglPanjang);
  if (/^Media Sosial\s*:\s*\d+ publikasi/.test(t)) return gantiTeksTerakhir(xmlParagraf, ": " + ctx.total.sosial + " publikasi");
  if (/^Media Massa\s*:\s*\d+ publikasi/.test(t)) return gantiTeksTerakhir(xmlParagraf, ": " + ctx.total.massa + " publikasi");
  if (/^Jumlah\s*:\s*\d+ publikasi/.test(t)) return gantiTeksTerakhir(xmlParagraf, ": " + ctx.total.jumlah + " publikasi");
  if (t.startsWith("Bengkulu, ")) return gantiTeksTerakhir(xmlParagraf, "Bengkulu, " + ctx.tglSingkat);
  return xmlParagraf;
}
// Terapkan gantiDataParagraf ke semua <w:p> di dalam sebuah tabel
// (kop + tanda tangan; tabel rekapitulasi ditangani isiTabelRekap).
function gantiDataDiTabel(xmlTabel, ctx) {
  return xmlTabel.replace(/<w:p[\s>][\s\S]*?<\/w:p>/g, (p0) => gantiDataParagraf(p0, ctx));
}

// Bangun ulang daftar judul/tautan tiap UPT di bagian rincian.
// segmenRincian: larik XML string di antara "2. Rincian..." dan "D. PENUTUP".
// rels: {berikut: nomor rId berikutnya, daftar: [{id, url}]} — setiap
// tautan baru mendapat relasi hyperlink sendiri (template memakai relasi,
// bukan field HYPERLINK). UPT nihil ditulis sebaris di label c./d.
function bangunRincian(segmenRincian, perUpt, perNama, contoh, rels) {
  const buatButirJudul = (n, teksJudul) => gantiTeksTerakhir(gantiTeksPertama(tanpaParaId(contoh.judul), n + "."), teksJudul);
  const buatButirTautan = (n, url) => {
    let xml = tanpaParaId(contoh.tautan);
    xml = gantiTeksPertama(xml, n + ".");
    const rid = "rId" + (rels.berikut++);
    rels.daftar.push({ id: rid, url });
    xml = xml.replace(/<w:hyperlink[^>]*r:id="[^"]*"/, (m0) => m0.replace(/r:id="[^"]*"/, `r:id="${rid}"`));
    return gantiTeksTerakhir(xml, url);
  };
  const keluar = [];
  let i = 0;
  while (i < segmenRincian.length) {
    const xml = segmenRincian[i];
    const t = teksParagraf(xml);
    const cocokBlok = /^(\d+)\)\s*(.+)$/.exec(t);
    if (!cocokBlok) { keluar.push(xml); i++; continue; }
    const u = perNama.get(cocokBlok[2]);
    keluar.push(xml); i++;
    if (!u) continue; // UPT tidak dikenal — biarkan blok apa adanya.
    // Paragraf a./b. di template adalah SATU run ("a. Media Sosial : 0
    // publikasi") — ganti SELURUH isi run dengan label + angka baru.
    if (i < segmenRincian.length && /^a\./.test(teksParagraf(segmenRincian[i]))) {
      keluar.push(gantiTeksTerakhir(segmenRincian[i], "a. Media Sosial : " + u.sosial + " publikasi")); i++;
    }
    if (i < segmenRincian.length && /^b\./.test(teksParagraf(segmenRincian[i]))) {
      keluar.push(gantiTeksTerakhir(segmenRincian[i], "b. Media Massa : " + u.massa + " publikasi")); i++;
    }
    const nihilJudul = u.judul.length === 1 && u.judul[0] === "Nihil";
    if (i < segmenRincian.length && /^c\./.test(teksParagraf(segmenRincian[i]))) {
      keluar.push(gantiTeksTerakhir(segmenRincian[i], nihilJudul ? "c. Judul Publikasi : Nihil" : "c. Judul Publikasi :")); i++;
    }
    const judulBaru = nihilJudul ? [] : u.judul.map((j, k) => buatButirJudul(k + 1, j));
    while (i < segmenRincian.length && segmenRincian[i].includes("<w:p") && !/^d\./.test(teksParagraf(segmenRincian[i])) && !/^\d+\)\s/.test(teksParagraf(segmenRincian[i]))) i++;
    keluar.push(...judulBaru);
    const nihilTautan = u.tautan.length === 1 && u.tautan[0] === "Nihil";
    if (i < segmenRincian.length && /^d\./.test(teksParagraf(segmenRincian[i]))) {
      keluar.push(gantiTeksTerakhir(segmenRincian[i], nihilTautan ? "d. Tautan Publikasi : Nihil" : "d. Tautan Publikasi :")); i++;
    }
    const tautanBaru = nihilTautan ? [] : u.tautan.map((t2, k) => buatButirTautan(k + 1, t2));
    while (i < segmenRincian.length && segmenRincian[i].includes("<w:p") && !/^\d+\)\s/.test(teksParagraf(segmenRincian[i]))) i++;
    keluar.push(...tautanBaru);
  }
  return keluar.join("");
}

// Gabungkan data laporan ke document.xml template. Hanya data yang
// berubah; semua teks, gaya, dan struktur lain dipertahankan byte demi byte.
// Mengembalikan {xml, rels}: rels = relasi hyperlink baru yang harus
// ditambahkan ke word/_rels/document.xml.rels (rId mulai dari ridAwal).
function gabungDocumentXml(xmlDokumen, hitung, ridAwal) {
  const { perUpt, total, tanggal } = hitung;
  const ctx = { tglPanjang: tanggalIndonesia(tanggal), tglSingkat: tanggalIndonesiaTanpaHari(tanggal), total };
  const perNama = new Map(perUpt.map((u) => [namaLaporan(u.nama), u]));

  // Pecah dokumen jadi segmen: tabel / paragraf / teks lain.
  // <w:tbl> dicocokkan dulu supaya <w:p> di dalam sel tabel tidak
  // terpecah sendiri; <w:p> tidak bersarang di dalam <w:p> lain.
  const polaSegmen = /(<w:tbl>[\s\S]*?<\/w:tbl>)|(<w:p[\s>][\s\S]*?<\/w:p>)/g;
  const segmen = [];
  let terakhir = 0, m;
  while ((m = polaSegmen.exec(xmlDokumen))) {
    if (m.index > terakhir) segmen.push({ jenis: "teks", xml: xmlDokumen.slice(terakhir, m.index) });
    segmen.push({ jenis: m[1] ? "tabel" : "paragraf", xml: m[0] });
    terakhir = m.index + m[0].length;
  }
  if (terakhir < xmlDokumen.length) segmen.push({ jenis: "teks", xml: xmlDokumen.slice(terakhir) });

  // Indeks bagian rincian (butir contoh diambil dari sini supaya tidak
  // tertukar dengan daftar bernomor di pendahuluan).
  let idxRincian = -1, idxPenutup = -1;
  segmen.forEach((s, i) => {
    if (s.jenis !== "paragraf") return;
    const t = teksParagraf(s.xml);
    if (t === "2. Rincian Publikasi Per Satuan Kerja") idxRincian = i;
    if (t === "D. PENUTUP") idxPenutup = i;
  });

  // Paragraf contoh untuk kloning butir daftar (dari bagian rincian).
  // Tautan berupa <w:hyperlink r:id> (relasi), bukan field HYPERLINK.
  let contohJudul = null, contohTautan = null;
  const awalContoh = idxRincian >= 0 ? idxRincian : 0;
  const akhirContoh = idxPenutup >= 0 ? idxPenutup : segmen.length;
  for (let i = awalContoh; i < akhirContoh; i++) {
    const s = segmen[i];
    if (s.jenis !== "paragraf") continue;
    const t = teksParagraf(s.xml);
    if (!contohTautan && s.xml.includes("<w:hyperlink")) contohTautan = s.xml;
    if (!contohJudul && /^1\.\S/.test(t) && !s.xml.includes("<w:hyperlink")) contohJudul = s.xml;
    if (contohJudul && contohTautan) break;
  }
  if (!contohJudul || !contohTautan) {
    throw new Error("Template laporan tidak dikenali (butir daftar tidak ditemukan).");
  }
  const contoh = { judul: contohJudul, tautan: contohTautan };

  // Fase 1: ganti data sederhana di semua segmen DI LUAR rincian.
  const hasil = segmen.map((s, i) => {
    if (s.jenis === "teks") return s.xml;
    if (s.jenis === "tabel") {
      if (s.xml.includes("Satuan Kerja")) return isiTabelRekap(s.xml, perUpt, total);
      return gantiDataDiTabel(s.xml, ctx);
    }
    if (idxRincian >= 0 && i > idxRincian && (idxPenutup < 0 || i < idxPenutup)) return s.xml; // rincian: fase 2
    return gantiDataParagraf(s.xml, ctx);
  });

  // Fase 2: bangun ulang daftar judul/tautan tiap UPT di bagian rincian.
  if (idxRincian >= 0 && idxPenutup > idxRincian) {
    const awal = idxRincian + 1, akhir = idxPenutup;
    const rels = { berikut: ridAwal, daftar: [] };
    const bangun = bangunRincian(hasil.slice(awal, akhir), perUpt, perNama, contoh, rels);
    return { xml: hasil.slice(0, awal).join("") + bangun + hasil.slice(akhir).join(""), rels: rels.daftar };
  }
  return { xml: hasil.join(""), rels: [] };
}

export async function buildDocx(data) {
  const hitung = hitungRekap(data);
  const tpl = await muatTemplate();
  // Relasi hyperlink LAMA dari template dibuang (menunjuk URL laporan 8 Nov
  // yang tidak lagi dipakai); relasi baru dibuat untuk URL laporan ini.
  // rId baru lanjut dari yang terbesar di antara relasi yang dipertahankan
  // (template 8 Nov: hanya rId1 gambar) supaya tidak bertabrakan.
  let relsTpl = tpl.teks["word/_rels/document.xml.rels"].replace(/<Relationship[^>]*relationships\/hyperlink[^>]*\/>/g, "");
  let ridAwal = 1;
  for (const m of relsTpl.matchAll(/rId(\d+)/g)) ridAwal = Math.max(ridAwal, Number(m[1]) + 1);
  const { xml: xmlBaru, rels: relsBaru } = gabungDocumentXml(tpl.teks["word/document.xml"], hitung, ridAwal);
  // Tambahkan relasi hyperlink baru ke rels.
  let relsXml = relsTpl;
  if (relsBaru.length) {
    const tambahan = relsBaru.map((r) => `<Relationship Id="${r.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${escXml(r.url)}" TargetMode="External"/>`).join("");
    relsXml = relsTpl.replace("</Relationships>", tambahan + "</Relationships>");
  }
  const tglSingkat = tanggalIndonesiaTanpaHari(hitung.tanggal);
  const [y, m, d] = String(hitung.tanggal || "2026-01-01").split("-");
  const dibuat = `${y}-${m}-${d}T13:00:00Z`; // 20.00 WIB = 13.00 UTC
  let core = tpl.teks["docProps/core.xml"];
  core = core.replace(TEMPLATE_TANGGAL_SINGKAT, tglSingkat);
  core = core.replace(/<dcterms:created[^>]*>[^<]*<\/dcterms:created>/, `<dcterms:created xsi:type="dcterms:W3CDTF">${dibuat}</dcterms:created>`);
  core = core.replace(/<dcterms:modified[^>]*>[^<]*<\/dcterms:modified>/, `<dcterms:modified xsi:type="dcterms:W3CDTF">${dibuat}</dcterms:modified>`);
  core = core.replace(/<dc:creator>[^<]*<\/dc:creator>/, "<dc:creator>ZonaPas</dc:creator>");
  core = core.replace(/<lastModifiedBy>[^<]*<\/lastModifiedBy>/, "<lastModifiedBy>ZonaPas</lastModifiedBy>");
  const zip = zipStored([
    // Nama entri di ZIP tetap "[Content_Types].xml" (nama bagian DOCX);
    // berkas sumbernya bernama Content_Types.xml (tanpa kurung siku)
    // supaya URL fetch-nya bersih.
    ["[Content_Types].xml", tpl.teks["Content_Types.xml"]],
    ["_rels/.rels", tpl.teks["_rels/.rels"]],
    ["docProps/core.xml", core],
    ["word/document.xml", xmlBaru],
    ["word/_rels/document.xml.rels", relsXml],
    ["word/media/image1.jpeg", tpl.biner["word/media/image1.jpeg"]],
  ]);
  return new Blob([zip], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
}

// ---------- PDF (dari nol, tanpa pustaka) ----------
// A4, margin 51pt (= 1020 twips template), Arial 11 -> Helvetica 11
// (pengganti metrik Arial; lihat catatan fidelity di kepala file).
const PDF_W = 595.28, PDF_H = 841.89, PDF_M = 51, PDF_CW = PDF_W - PDF_M * 2;
const PDF_LH = 13.8; // tinggi baris 276 twips
const PDF_HITAM = [0, 0, 0], PDF_BIRU_TUA = [0.039, 0.122, 0.267], PDF_TAUTAN = [0.114, 0.306, 0.847], PDF_GARIS_TABEL = [0.541, 0.6, 0.702], PDF_ISI_TABEL = [0.902, 0.925, 0.961], PDF_GARIS_KOP = [0.086, 0.137, 0.239]; // #16233D, garis ganda bawah kop

const LEBAR_HELVETICA = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const LEBAR_HELVETICA_B = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 722, 556, 556, 500, 334, 280, 334, 584];
function lebarWinAnsi(kode, tebal) {
  if (kode >= 32 && kode <= 126) return (tebal ? LEBAR_HELVETICA_B : LEBAR_HELVETICA)[kode - 32];
  if (kode === 160) return 278;
  if (kode === 133) return 1000; // …
  if (kode === 145 || kode === 146) return tebal ? 238 : 191;
  if (kode === 147 || kode === 148) return tebal ? 474 : 355;
  if (kode === 149) return 350; // •
  if (kode === 150) return 556; // –
  if (kode === 151) return 1000; // —
  if (kode === 153) return 1000; // ™
  if (kode === 128) return 556; // €
  // Huruf Latin-1 beraksen: pakai lebar huruf dasarnya.
  const dasar = { 192: 65, 193: 65, 194: 65, 195: 65, 196: 65, 197: 65, 198: 65, 199: 67, 200: 69, 201: 69, 202: 69, 203: 69, 204: 73, 205: 73, 206: 73, 207: 73, 209: 78, 210: 79, 211: 79, 212: 79, 213: 79, 214: 79, 217: 85, 218: 85, 219: 85, 220: 85, 221: 89, 224: 97, 225: 97, 226: 97, 227: 97, 228: 97, 229: 97, 230: 97, 231: 99, 232: 101, 233: 101, 234: 101, 235: 101, 236: 105, 237: 105, 238: 105, 239: 105, 241: 110, 242: 111, 243: 111, 244: 111, 245: 111, 246: 111, 249: 117, 250: 117, 251: 117, 252: 117, 253: 121, 255: 121, 223: 115 }[kode];
  if (dasar) return lebarWinAnsi(dasar, tebal);
  return 556;
}
function keWinAnsi(teks) {
  // -> larik kode WinAnsi; karakter yang tidak ada (emoji dsb.) dibuang.
  const peta = { "•": 149, "–": 150, "—": 151, "‘": 145, "’": 146, "“": 147, "”": 148, "…": 133, "™": 153, "€": 128, " ": 160 };
  const out = [];
  for (const ch of String(teks ?? "")) {
    if (peta[ch] !== undefined) { out.push(peta[ch]); continue; }
    const k = ch.codePointAt(0);
    if (k >= 32 && k <= 255) out.push(k);
    // selain itu (emoji dsb.): dibuang
  }
  return out;
}
function lebarTeks(teks, ukuran, tebal) {
  let w = 0;
  for (const k of keWinAnsi(teks)) w += lebarWinAnsi(k, tebal);
  return (w * ukuran) / 1000;
}
function pdfString(teks) {
  const b = keWinAnsi(teks).map((k) => (k === 40 ? "\\(" : k === 41 ? "\\)" : k === 92 ? "\\\\" : k < 32 || k > 126 ? "\\" + k.toString(8).padStart(3, "0") : String.fromCharCode(k))).join("");
  return "(" + b + ")";
}
function rgb(c) { return `${c[0]} ${c[1]} ${c[2]} rg`; }

class PdfDokumen {
  constructor(logoBytes) {
    this.logoBytes = logoBytes; // JPEG logo dari berkas template
    this.halaman = []; // {ops: [], tautan: [{x0,y0,x1,y1,uri}]}
    this.halBaru();
  }
  halBaru() {
    this.halaman.push({ ops: [], tautan: [] });
    this.y = PDF_H - PDF_M; // garis dasar baris pertama
  }
  get hal() { return this.halaman[this.halaman.length - 1]; }
  pastikan(butuh) {
    if (this.y - butuh < PDF_M) this.halBaru();
  }
  // Bagi runs menjadi baris-baris sesuai lebar; runs: [{teks, tebal, warna, link}]
  bagiBaris(runs, lebar) {
    // Pecah menjadi kata-kata (spasi dipertahankan sebagai pemisah).
    const kata = [];
    for (const r of runs) {
      const bagian = String(r.teks).split(/(\s+)/);
      for (const b of bagian) {
        if (b === "") continue;
        kata.push({ ...r, teks: b, spasi: /^\s+$/.test(b) });
      }
    }
    const baris = [];
    let kini = [], lebarKini = 0;
    const dorong = () => { if (kini.length) baris.push(kini); kini = []; lebarKini = 0; };
    for (const k of kata) {
      if (k.spasi) {
        // Spasi di awal baris dibuang; spasi lain menempel di kata sebelumnya.
        if (kini.length) { kini.push(k); lebarKini += lebarTeks(" ", 11, k.tebal); }
        continue;
      }
      let w = lebarTeks(k.teks, 11, k.tebal);
      if (w > lebar && kini.length === 0) {
        // Kata lebih panjang dari baris (URL panjang): potong per karakter.
        let sisa = k.teks;
        while (sisa) {
          let pot = "";
          for (const ch of sisa) {
            if (lebarTeks(pot + ch, 11, k.tebal) > lebar) break;
            pot += ch;
          }
          if (!pot) pot = sisa[0];
          baris.push([{ ...k, teks: pot }]);
          sisa = sisa.slice(pot.length);
        }
        continue;
      }
      if (lebarKini + w > lebar && kini.length) { dorong(); }
      kini.push(k);
      lebarKini += w;
    }
    dorong();
    return baris;
  }
  gambarBaris(baris, x, yDasar, rata, lebar) {
    // Gambar satu baris (larik kata-run) pada posisi y (garis dasar).
    const teksBaris = baris.map((k) => k.teks).join("");
    let total = 0;
    for (const k of baris) total += lebarTeks(k.teks, 11, k.tebal);
    let x0 = x;
    let spasiTambah = 0;
    if (rata === "center") x0 = x + (lebar - total) / 2;
    else if (rata === "both") {
      const celah = baris.filter((k) => k.spasi).length;
      if (celah > 0) spasiTambah = (lebar - total) / celah;
    }
    let cx = x0;
    let fontKini = "", warnaKini = "";
    const ops = this.hal.ops;
    for (const k of baris) {
      const font = k.tebal ? "/F2" : "/F1";
      const warna = rgb(k.warna || PDF_HITAM);
      if (font !== fontKini || warna !== warnaKini) {
        if (fontKini) ops.push("ET");
        ops.push(`BT ${font} 11 Tf ${warna}`);
        fontKini = font; warnaKini = warna;
      }
      const w = lebarTeks(k.teks, 11, k.tebal);
      if (k.spasi) {
        // Spasi justify: geser dengan Tm berikutnya (tidak digambar).
        cx += w + spasiTambah;
        continue;
      }
      ops.push(`1 0 0 1 ${cx.toFixed(2)} ${yDasar.toFixed(2)} Tm ${pdfString(k.teks)} Tj`);
      if (k.link) {
        const yAtas = yDasar + 9, yBawah = yDasar - 3;
        this.hal.tautan.push({ x0: cx, y0: PDF_H - yAtas, x1: cx + w, y1: PDF_H - yBawah, uri: k.link });
        ops.push(`${rgb(PDF_TAUTAN)} ${cx.toFixed(2)} ${(yDasar - 1.5).toFixed(2)} m ${(cx + w).toFixed(2)} ${(yDasar - 1.5).toFixed(2)} l S`);
      }
      cx += w;
    }
    if (fontKini) ops.push("ET");
  }
  paragraf(runs, opts = {}) {
    const { rata = "left", indentKiri = 0, indentBarisPertama = 0, gantung = 0, sebelum = 0, sesudah = 1, jaga = 0 } = opts;
    const lebar = PDF_CW - indentKiri;
    // Lebar bungkus memakai baris tersempit: baris lanjutan (gantung) atau
    // baris pertama bila menjorok ke dalam — supaya tidak meluber.
    const lebarBungkus = lebar - Math.max(0, gantung) - Math.max(0, indentBarisPertama);
    const baris = this.bagiBaris(runs, lebarBungkus);
    if (!baris.length) { this.y -= PDF_LH; return; }
    this.pastikan(jaga || (sebelum + baris.length * PDF_LH + sesudah));
    this.y -= sebelum;
    baris.forEach((b, i) => {
      const indent = i === 0 ? indentKiri + (indentBarisPertama || 0) : indentKiri + (gantung || 0);
      const lebarBaris = PDF_CW - indent;
      const rataBaris = rata === "both" && i < baris.length - 1 ? "both" : rata === "center" ? "center" : "left";
      this.gambarBaris(b, PDF_M + indent, this.y, rataBaris, lebarBaris);
      this.y -= PDF_LH;
    });
    this.y -= sesudah;
  }
  paraTeks(teks, opts = {}, tebal = false, warna = PDF_HITAM) {
    this.paragraf([{ teks, tebal, warna }], opts);
  }
  tabelRekap(perUpt, total) {
    const lebarKol = [27.8, 213.2, 72.35, 72.35, 57.85];
    const x0 = PDF_M + 7.6;
    const isi = perUpt.map((u, i) => [String(i + 1), u.nama, String(u.sosial), String(u.massa), String(u.jumlah)]);
    isi.push(["", "JUMLAH", String(total.sosial), String(total.massa), String(total.jumlah)]);
    const kepala = ["No.", "Satuan Kerja", "Media Sosial", "Media Massa", "Jumlah"];
    const semuaBaris = [kepala, ...isi];
    const tinggiBaris = semuaBaris.map((baris, ri) => {
      let maks = 1;
      baris.forEach((sel, ci) => {
        const tebal = ri === 0 || ri === semuaBaris.length - 1;
        const lebar = lebarKol[ci] - 4;
        const bb = this.bagiBaris([{ teks: sel, tebal }], lebar);
        maks = Math.max(maks, bb.length);
      });
      return maks * PDF_LH + 2;
    });
    const totalTinggi = tinggiBaris.reduce((a, b) => a + b, 0);
    this.pastikan(totalTinggi);
    let y = this.y;
    semuaBaris.forEach((baris, ri) => {
      const h = tinggiBaris[ri];
      const yBawah = y - h;
      let x = x0;
      baris.forEach((sel, ci) => {
        const tebal = ri === 0 || ri === semuaBaris.length - 1;
        if (ri === 0) {
          this.hal.ops.push(`${PDF_ISI_TABEL[0]} ${PDF_ISI_TABEL[1]} ${PDF_ISI_TABEL[2]} rg ${x.toFixed(2)} ${yBawah.toFixed(2)} ${lebarKol[ci].toFixed(2)} ${h.toFixed(2)} re f`);
        }
        const bb = this.bagiBaris([{ teks: sel, tebal, warna: tebal ? PDF_BIRU_TUA : PDF_HITAM }], lebarKol[ci] - 4);
        const tengah = ci !== 1;
        bb.forEach((b, li) => {
          const yDasar = y - 1 - PDF_LH * (li + 1) + 3.8;
          this.gambarBaris(b, x + 2, yDasar, tengah ? "center" : "left", lebarKol[ci] - 4);
        });
        x += lebarKol[ci];
      });
      y = yBawah;
    });
    // Garis tepi + garis dalam.
    const ops = this.hal.ops;
    const yAtas = this.y, yBawahAkhir = y;
    ops.push(`${rgb(PDF_GARIS_TABEL)} 0.5 w`);
    let x = x0;
    ops.push(`${x0.toFixed(2)} ${yAtas.toFixed(2)} m ${(x0 + lebarKol.reduce((a, b) => a + b, 0)).toFixed(2)} ${yAtas.toFixed(2)} l S`);
    ops.push(`${x0.toFixed(2)} ${yBawahAkhir.toFixed(2)} m ${(x0 + lebarKol.reduce((a, b) => a + b, 0)).toFixed(2)} ${yBawahAkhir.toFixed(2)} l S`);
    let yJalan = yAtas;
    tinggiBaris.forEach((h) => { yJalan -= h; ops.push(`${x0.toFixed(2)} ${yJalan.toFixed(2)} m ${(x0 + lebarKol.reduce((a, b) => a + b, 0)).toFixed(2)} ${yJalan.toFixed(2)} l S`); });
    lebarKol.reduce((acc, w) => { const xx = acc + w; ops.push(`${xx.toFixed(2)} ${yAtas.toFixed(2)} m ${xx.toFixed(2)} ${yBawahAkhir.toFixed(2)} l S`); return xx; }, x0);
    ops.push(`${x0.toFixed(2)} ${yAtas.toFixed(2)} m ${x0.toFixed(2)} ${yBawahAkhir.toFixed(2)} l S`);
    this.y = yBawahAkhir - 1;
  }
  rakit() {
    // Susun objek PDF -> Uint8Array.
    const objek = [];
    const tambah = (isi) => { objek.push(isi); return objek.length; };
    const idKatalog = tambah(null);
    const idHalaman = tambah(null);
    const idF1 = tambah("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
    const idF2 = tambah("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
    const idGambar = tambah(null);
    const idHalamanObj = [];
    const idKonten = [];
    for (const h of this.halaman) {
      idHalamanObj.push(tambah(null));
      idKonten.push(tambah(null));
    }
    objek[idKatalog - 1] = `<< /Type /Catalog /Pages ${idHalaman} 0 R >>`;
    objek[idHalaman - 1] = `<< /Type /Pages /Kids [${idHalamanObj.map((i) => i + " 0 R").join(" ")}] /Count ${idHalamanObj.length} >>`;
    const logo = this.logoBytes;
    objek[idGambar - 1] = { streamBytes: logo, dict: `<< /Type /XObject /Subtype /Image /Width 480 /Height 480 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${logo.length} >>` };
    this.halaman.forEach((h, i) => {
      const anot = h.tautan.map((t) => {
        objek.push(`<< /Type /Annot /Subtype /Link /Rect [${t.x0.toFixed(2)} ${t.y0.toFixed(2)} ${t.x1.toFixed(2)} ${t.y1.toFixed(2)}] /Border [0 0 0] /A << /S /URI /URI (${t.uri.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)")}) >> >>`);
        return objek.length;
      });
      const aliran = h.ops.join("\n");
      objek[idKonten[i] - 1] = { stream: aliran, dict: `<< /Length ${new TextEncoder().encode(aliran).length} >>` };
      objek[idHalamanObj[i] - 1] = `<< /Type /Page /Parent ${idHalaman} 0 R /MediaBox [0 0 ${PDF_W} ${PDF_H}] /Resources << /Font << /F1 ${idF1} 0 R /F2 ${idF2} 0 R >> /XObject << /Logo ${idGambar} 0 R >> >> /Contents ${idKonten[i]} 0 R${anot.length ? ` /Annots [${anot.map((a) => a + " 0 R").join(" ")}]` : ""} >>`;
    });
    const enc = new TextEncoder();
    const bagian = [enc.encode("%PDF-1.4\n")];
    const offset = [0];
    let pos = bagian[0].length;
    objek.forEach((o, i) => {
      offset[i + 1] = pos;
      let b;
      if (o && typeof o === "object") {
        const kepala = enc.encode(`${i + 1} 0 obj\n${o.dict}\nstream\n`);
        const ekor = enc.encode("\nendstream\nendobj\n");
        const isiStream = o.streamBytes || enc.encode(o.stream);
        b = new Uint8Array(kepala.length + isiStream.length + ekor.length);
        b.set(kepala, 0);
        b.set(isiStream, kepala.length);
        b.set(ekor, kepala.length + isiStream.length);
      } else {
        b = enc.encode(`${i + 1} 0 obj\n${o}\nendobj\n`);
      }
      bagian.push(b);
      pos += b.length;
    });
    const xrefPos = pos;
    let xref = `xref\n0 ${objek.length + 1}\n0000000000 65535 f \n`;
    for (let i = 1; i <= objek.length; i++) xref += String(offset[i]).padStart(10, "0") + " 00000 n \n";
    xref += `trailer\n<< /Size ${objek.length + 1} /Root ${idKatalog} 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;
    bagian.push(enc.encode(xref));
    const total = bagian.reduce((a, b) => a + b.length, 0);
    const out = new Uint8Array(total);
    let p = 0;
    for (const b of bagian) { out.set(b, p); p += b.length; }
    return out;
  }
}

// ---------- Perakitan PDF ----------
// KEMBALI ke builder lama (buildPdfLegacy) — konversi DOCX->PDF
// DINONAKTIFKAN 08 Nov 2026 ~23.02 WIB atas perintah Bos Besar
// ("Kembalikan saja saat tombol masih berfungsi"). Alasannya: konversi
// membuat wadah salinan laporan di akhir body (buildPdfDariDocx) yang
// MENELAN semua ketukan — tombol Unduh PDF/Word, Kirim WA, bahkan mode
// gelap dan Muat Ulang jadi tidak merespon di HP maupun di uji klik
// (hit-test: "covered/obscured"; keyboard Tab+Spasi tetap jalan).
// pointer-events:none + cache-bust v7 TIDAK menyelesaikan — modul lama
// tersimpan di cache terus dipakai. Builder lama tidak membuat wadah
// apa pun, jadi tombol kembali berfungsi. Konversi tetap tersimpan di
// buildPdfDariDocx di bawah (tidak dipanggil) untuk dikerjakan ulang
// di lain waktu bila sudah ada cara yang aman.
export async function buildPdf(data) {
  return buildPdfLegacy(data);
}

async function buildPdfDariDocx(data) {
  const blobDocx = await buildDocx(data);
  // Muat pustaka lewat <script> (UMD), BUKAN import() ESM: versi ESM
  // jsDelivr (+esm) untuk html2pdf.js rusak (jspdf-plugin mencoba
  // menyetel getPageSize pada objek undefined). docx-preview UMD juga
  // butuh JSZip global dimuat dulu.
  const muatScript = (src) => new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src; s.onload = resolve;
    s.onerror = () => reject(new Error("gagal memuat " + src));
    document.head.appendChild(s);
  });
  if (!window.JSZip) await muatScript("https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js");
  if (!window.docx) await muatScript("https://cdn.jsdelivr.net/npm/docx-preview@0.3.5/dist/docx-preview.min.js");
  if (!window.html2pdf) await muatScript("https://cdn.jsdelivr.net/npm/html2pdf.js@0.10.1/dist/html2pdf.bundle.min.js");
  const renderAsync = window.docx.renderAsync;
  const html2pdf = window.html2pdf;
  // Wadah HARUS di ALUR NORMAL dokumen (position:static, tanpa
  // left/top/z-index) agar html2canvas bisa menggambar isinya. Terbukti
  // lewat uji: wadah di luar layar (left:-10000px), di belakang halaman
  // (z-index:-1), position:absolute, maupun position:fixed — semuanya
  // menghasilkan PDF 1 halaman KOSONG (~9 KB); hanya wadah di alur
  // normal yang menghasilkan PDF 4 halaman berisi gambar (2,7 MB).
  // Layar penutup juga TIDAK boleh dipakai (ikut tergambar). Wadah
  // ditambahkan di AKHIR body (di bawah viewport pengguna yang sedang
  // berada di seksi Laporan) lalu dihapus setelah selesai; opacity:0
  // TIDAK boleh dipakai (html2canvas menangkapnya transparan).
  // pointer-events:none WAJIB: wadah berisi salinan penuh laporan dan
  // bila ia (atau salinannya yang tertinggal) menerima ketukan, SEMUA
  // tombol di halaman jadi tidak merespon — ketukan ditelan wadah
  // (keyboard tetap jalan karena tidak memakai hit-test). pointer-events
  // tidak memengaruhi gambar yang ditangkap html2canvas.
  const wadah = document.createElement("div");
  wadah.style.cssText = "width:210mm;background:#fff;margin:0 auto;pointer-events:none;";
  document.body.appendChild(wadah);
  try {
    await renderAsync(blobDocx, wadah, null, { breakPages: true });
    const pdf = await html2pdf().set({
      margin: 0,
      filename: "laporan.pdf",
      image: { type: "jpeg", quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true, backgroundColor: "#ffffff" },
      jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
      pagebreak: { mode: ["css", "legacy"] },
    }).from(wadah).outputPdf("blob");
    return pdf;
  } finally {
    wadah.remove();
  }
}

async function buildPdfLegacy(data) {
  const tpl = await muatTemplate();
  const hitung = hitungRekap(data);
  const tanggal = hitung.tanggal, total = hitung.total;
  const perUpt = hitung.perUpt.map((u) => ({ ...u, nama: namaLaporan(u.nama) }));
  const tglPanjang = tanggalIndonesia(tanggal);
  const tglSingkat = tanggalIndonesiaTanpaHari(tanggal);
  const doc = new PdfDokumen(tpl.biner["word/media/image1.jpeg"]);
  const TW = (n) => n / 20; // twips -> pt
  const judulBagian = (teks) => doc.paraTeks(teks, { sebelum: 12, sesudah: 4 }, true, PDF_BIRU_TUA);
  const subJudul = (teks) => doc.paraTeks(teks, { indentKiri: TW(284), sebelum: 8, sesudah: 0 }, true);
  // Paragraf isi menjorok seperti template: baris pertama masuk sejauh
  // satu tab, seluruh paragraf bergeser ke kanan. Tingkat atas
  // (PENDAHULUAN, KEGIATAN, PENUTUP): kiri 284 twips, baris pertama
  // +425. Di bawah sub-judul (Umum, Maksud, Ruang Lingkup): kiri 567,
  // baris pertama +426. (Satuan: twips, sama seperti template DOCX.)
  const tubuh = (teks, sesudah = 8, kiri = 284, barisPertama = 425) =>
    doc.paraTeks(teks, { rata: "both", indentKiri: TW(kiri), indentBarisPertama: TW(barisPertama), sesudah });
  const tubuhSub = (teks, sesudah = 8) => tubuh(teks, sesudah, 567, 426);

  // --- Kop: logo 72x72pt + 5 baris nama instansi (tengah, kolom kanan) ---
  {
    const yAtas = doc.y + 11;
    const xLogo = PDF_M + 1.5, yLogo = yAtas - 72;
    doc.hal.ops.push(`q 72 0 0 72 ${xLogo.toFixed(2)} ${yLogo.toFixed(2)} cm /Logo Do Q`);
    const xTeks = PDF_M + 75, lebarTeks2 = 418.3;
    const kop = [
      ["KEMENTERIAN IMIGRASI DAN PEMASYARAKATAN REPUBLIK INDONESIA", true, PDF_BIRU_TUA],
      ["DIREKTORAT JENDERAL PEMASYARAKATAN", true, PDF_BIRU_TUA],
      ["KANTOR WILAYAH BENGKULU", true, PDF_BIRU_TUA],
      ["Jl. Batang Hari No.17, Kec. Ratu Agung, Kota Bengkulu", false, PDF_HITAM],
      ["Pos-el : bengkuluditjenpas@gmail.com", false, PDF_HITAM],
    ];
    kop.forEach(([t, tebal, warna], i) => {
      doc.gambarBaris([{ teks: t, tebal, warna }], xTeks, yAtas - 11 - i * PDF_LH, "center", lebarTeks2);
    });
    // Garis ganda di bawah kop (border bawah ganda paragraf kosong di
    // template DOCX, warna #16233D), di celah antara kop dan judul.
    doc.hal.ops.push(`${rgb(PDF_GARIS_KOP)} 0.5 w`);
    doc.hal.ops.push(`${PDF_M.toFixed(2)} ${(yAtas - 74).toFixed(2)} m ${(PDF_M + PDF_CW).toFixed(2)} ${(yAtas - 74).toFixed(2)} l S`);
    doc.hal.ops.push(`${PDF_M.toFixed(2)} ${(yAtas - 76).toFixed(2)} m ${(PDF_M + PDF_CW).toFixed(2)} ${(yAtas - 76).toFixed(2)} l S`);
    // Spasi tambahan 12pt antara garis ganda kop dan judul LAPORAN.
    doc.y = yAtas - 72 - PDF_LH - 12;
  }
  // --- Judul laporan ---
  for (const baris of ["LAPORAN", "TENTANG", "DATA HARIAN HASIL RILIS DAN PUBLIKASI MEDIA SOSIAL", "UNIT PELAKSANA TEKNIS PEMASYARAKATAN DI LINGKUNGAN", "KANTOR WILAYAH DIREKTORAT JENDERAL PEMASYARAKATAN BENGKULU"]) {
    doc.paraTeks(baris, { rata: "center", sesudah: 1 }, true);
  }
  // --- A. PENDAHULUAN ---
  judulBagian("A. PENDAHULUAN");
  tubuh(TEKS_PENDAHULUAN);
  subJudul("1. Umum");
  tubuhSub(TEKS_UMUM);
  subJudul("2. Maksud dan Tujuan");
  tubuhSub(TEKS_MAKSUD);
  // Butir bernomor seperti numbering otomatis Word: nomor digambar di
  // kolom nomor, teks digambar sebagai paragraf di kolom teks — sehingga
  // baris lanjutan sejajar dengan baris pertama (bukan mulai di bawah
  // nomor). xNomor = posisi kiri kolom nomor, xTeks = posisi kiri kolom
  // teks (tab stop di template DOCX). Jumlah baris dihitung dulu agar
  // pastikan() jalan SEBELUM nomor digambar — bila pindah halaman,
  // nomor dan teks tetap sebaris.
  const butirBernomor = (nomor, runsTeks, xNomor, xTeks, sesudah = 8, rata = "left") => {
    const nBaris = Math.max(1, doc.bagiBaris(runsTeks, PDF_CW - xTeks).length);
    doc.pastikan(nBaris * PDF_LH + sesudah);
    const yAwal = doc.y;
    doc.gambarBaris([{ teks: `${nomor}.`, tebal: false }], PDF_M + xNomor, yAwal, "left", xTeks - xNomor);
    doc.paragraf(runsTeks, { rata, indentKiri: xTeks, sesudah });
  };
  // Daftar tujuan: nomor di kolom 567, teks di kolom 851 (tab stop
  // template); spasi antar butir disamakan dengan paragraf isi (8).
  TUJUAN.forEach((t, i) => {
    butirBernomor(i + 1, [{ teks: t, tebal: false }], TW(567), TW(851), 8, "both");
  });
  subJudul("3. Ruang Lingkup");
  tubuhSub(TEKS_RUANG_LINGKUP, 1);
  doc.paraTeks(`• Hari/tanggal : ${tglPanjang}`, { indentKiri: TW(720), sesudah: 1 });
  doc.paraTeks("• Pukul : 20.00 WIB", { indentKiri: TW(720), sesudah: 1 });
  // --- B. KEGIATAN YANG DILAKSANAKAN ---
  judulBagian("B. KEGIATAN YANG DILAKSANAKAN");
  tubuh(TEKS_KEGIATAN_1);
  tubuh(TEKS_KEGIATAN_2);
  tubuh(TEKS_KEGIATAN_3);
  // --- C. HASIL YANG DICAPAI ---
  judulBagian("C. HASIL YANG DICAPAI");
  doc.paraTeks("1. Rekapitulasi Publikasi", { indentKiri: TW(142), sebelum: 4, sesudah: 3 }, true);
  doc.paragraf([{ teks: "Jumlah publikasi pada hari pelaporan adalah sebagai berikut:" }], { rata: "both", indentBarisPertama: TW(567), sesudah: 3 });
  const garisHitung = (label, n) => {
    doc.pastikan(PDF_LH + 1);
    doc.gambarBaris([{ teks: label }], PDF_M + TW(567), doc.y, "left", 200);
    doc.gambarBaris([{ teks: `: ${n} publikasi` }], PDF_M + TW(1985), doc.y, "left", 200);
    doc.y -= PDF_LH + 1;
  };
  garisHitung("Media Sosial", total.sosial);
  garisHitung("Media Massa", total.massa);
  garisHitung("Jumlah", total.jumlah);
  doc.paragraf([{ teks: "Rincian jumlah publikasi per satuan kerja disajikan dalam tabel berikut:" }], { rata: "both", indentBarisPertama: TW(284), sesudah: 3 });
  doc.tabelRekap(perUpt, total);
  doc.y -= PDF_LH;
  // --- 2. Rincian Publikasi Per Satuan Kerja ---
  doc.paraTeks("2. Rincian Publikasi Per Satuan Kerja", { indentKiri: TW(142), sesudah: 0 }, true);
  perUpt.forEach((u, i) => {
    // Satu baris kosong antar laporan UPT (kecuali sebelum UPT pertama).
    doc.paragraf([{ teks: `${i + 1}) ${u.nama}`, tebal: true, warna: PDF_BIRU_TUA }], { indentBarisPertama: TW(284), sebelum: i === 0 ? 0 : PDF_LH, sesudah: 0 });
    doc.paraTeks(`a. Media Sosial : ${u.sosial} publikasi`, { indentKiri: TW(360), sesudah: 0 });
    doc.paraTeks(`b. Media Massa : ${u.massa} publikasi`, { indentKiri: TW(360), sesudah: 0 });
    // UPT nihil ditulis sebaris di labelnya (seperti berkas PDF terkirim),
    // tanpa butir bernomor terpisah.
    if (u.judul.length === 1 && u.judul[0] === "Nihil") {
      doc.paraTeks("c. Judul Publikasi : Nihil", { indentKiri: TW(360), sesudah: 1 });
    } else {
      doc.paraTeks("c. Judul Publikasi :", { indentKiri: TW(360), sesudah: 1 });
      u.judul.forEach((j, k) => {
        butirBernomor(k + 1, [{ teks: j, tebal: false }], TW(720), TW(1080), 1);
      });
    }
    if (u.tautan.length === 1 && u.tautan[0] === "Nihil") {
      doc.paraTeks("d. Tautan Publikasi : Nihil", { indentKiri: TW(360), sesudah: 1 });
    } else {
      doc.paraTeks("d. Tautan Publikasi :", { indentKiri: TW(360), sesudah: 1 });
      u.tautan.forEach((t, k) => {
        butirBernomor(k + 1, [{ teks: t, tebal: false, warna: PDF_TAUTAN, link: t }], TW(720), TW(1080), 1);
      });
    }
  });
  // --- D. PENUTUP ---
  judulBagian("D. PENUTUP");
  tubuh(TEKS_PENUTUP_1);
  // Paragraf penutup kedua: hanya baris pertama menjorok (709 twips,
  // tanpa geser kiri) seperti template.
  tubuh(TEKS_PENUTUP_2, 8, 0, 709);
  doc.y -= PDF_LH;
  // --- Blok tanda tangan (dijaga utuh satu halaman) ---
  doc.pastikan(7 * PDF_LH);
  const xKanan = PDF_M + PDF_CW;
  const barisTtd = [
    [`Bengkulu, ${tglSingkat}`, false],
    ["Kepala Kantor Wilayah,", false],
    ["", false],
    ["ttd", false],
    ["", false],
    ["MASJUNO", true],
  ];
  for (const [t, tebal] of barisTtd) {
    if (t) doc.gambarBaris([{ teks: t, tebal }], xKanan - 180, doc.y, "left", 180);
    doc.y -= PDF_LH;
  }
  return new Blob([doc.rakit()], { type: "application/pdf" });
}
