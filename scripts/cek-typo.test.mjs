// Pengujian pemeriksa typo (public/cek-typo.mjs).
// Jalankan: node scripts/cek-typo.test.mjs
// Kamus di sini hanya fiktif kecil — kamus asli (~45 ribu kata) dimuat
// dari public/kamus-id.json oleh browser, bukan oleh pengujian ini.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { kataDikenal, cekTypo, cekTypoGabungan } from "../public/cek-typo.mjs";

const KAMUS = new Set([
  "masyarakat", "laksana", "tulis", "ambil", "kirim", "sapu", "pakai",
  "ada", "jadi", "hari", "buku", "balik", "datang", "pelajar", "jalan",
  "bengkulu", "dan", "di", "ke", "yang", "untuk", "dengan", "berita",
  "kegiatan", "lapas", "pemasyarakatan", "rutan", "bapas", "kakanwil",
  "kegiatan", "berjalan", "lancar", "kunjungi", "info", "tebal", "tautan",
  "semarak", "bakti", "peduli", "lingkungan", "wujud", "nyata", "judul",
  "kelas", "ingat", "cat", "kerja", "adil", "lanjut", "selesai", "hasil",
  "daya", "royong", "tahu",
]);

describe("kataDikenal (stemming ringan)", () => {
  it("kata dasar langsung dikenal", () => {
    assert.equal(kataDikenal("masyarakat", KAMUS), true);
    assert.equal(kataDikenal("bengkulu", KAMUS), true);
  });
  it("awalan + akhiran: pemasyarakatan -> masyarakat", () => {
    assert.equal(kataDikenal("pemasyarakatan", KAMUS), true);
  });
  it("di- + -kan: dilaksanakan -> laksana", () => {
    assert.equal(kataDikenal("dilaksanakan", KAMUS), true);
  });
  it("meng- -> k: mengirim -> kirim", () => {
    assert.equal(kataDikenal("mengirim", KAMUS), true);
  });
  it("meny- -> s: menyapu -> sapu", () => {
    assert.equal(kataDikenal("menyapu", KAMUS), true);
  });
  it("mem- -> p: memakai -> pakai", () => {
    assert.equal(kataDikenal("memakai", KAMUS), true);
  });
  it("men- -> t: menulis -> tulis", () => {
    assert.equal(kataDikenal("menulis", KAMUS), true);
  });
  it("ke- + -an: kedatangan -> datang", () => {
    assert.equal(kataDikenal("kedatangan", KAMUS), true);
  });
  it("tiga lapis imbuhan: memperingati -> peringati -> peringat -> ingat", () => {
    assert.equal(kataDikenal("memperingati", KAMUS), true);
    assert.equal(kataDikenal("berkeadilan", KAMUS), true);
    assert.equal(kataDikenal("berkelanjutan", KAMUS), true);
    assert.equal(kataDikenal("keberhasilan", KAMUS), true);
    assert.equal(kataDikenal("penyelesaiannya", KAMUS), true);
  });
  it("awalan be-: bekerja -> kerja; penge-: pengecatan -> cat", () => {
    assert.equal(kataDikenal("bekerja", KAMUS), true);
    assert.equal(kataDikenal("pengecatan", KAMUS), true);
    assert.equal(kataDikenal("pengetahuan", KAMUS), true);
  });
  it("kata yang memang salah tidak dikenal", () => {
    assert.equal(kataDikenal("berjaln", KAMUS), false);
    assert.equal(kataDikenal("lancr", KAMUS), false);
    assert.equal(kataDikenal("seharunya", KAMUS), false);
    assert.equal(kataDikenal("mempringati", KAMUS), false);
    assert.equal(kataDikenal("royonh", KAMUS), false);
  });
});

describe("cekTypo", () => {
  it("teks benar menghasilkan 0 temuan", () => {
    assert.deepEqual(cekTypo("Kegiatan lapas berjalan lancar", KAMUS), []);
  });
  it("typo ditemukan sekali meski muncul berkali-kali", () => {
    const t = cekTypo("Berjaln berjaln berjaln", KAMUS);
    assert.equal(t.length, 1);
    assert.equal(t[0].kata, "Berjaln");
  });
  it("typo tidak menutupi kata benar di sekitarnya", () => {
    const t = cekTypo("Kegiatan lapas berjaln lancr dan pemasyarakatan", KAMUS);
    assert.deepEqual(t.map((x) => x.kata), ["berjaln", "lancr"]);
  });
  it("singkatan kapital semua dilewati", () => {
    assert.deepEqual(cekTypo("UPT Lapas Kelas IIA Bengkulu", KAMUS), []);
  });
  it("tautan dan Markdown tidak diperiksa sebagai kata", () => {
    assert.deepEqual(cekTypo("Kunjungi https://example.com untuk info", KAMUS), []);
    assert.deepEqual(cekTypo("Judul **tebal** dan [tautan](https://x.id)", KAMUS), []);
  });
  it("gambar Markdown dan nama berkas foto tidak diperiksa sebagai kata", () => {
    assert.deepEqual(
      cekTypo("![340242](/images/isi-penguatan-tusi-di-lapas-kelas-iia-curup-20261107161627268629.jpg) Kegiatan berjalan", KAMUS),
      [],
    );
    assert.deepEqual(cekTypo("Kegiatan /images/isi-berita-123.jpg berjalan lancar", KAMUS), []);
  });
  it("kata ulang (tanda hubung) diperiksa per bagian", () => {
    assert.deepEqual(cekTypo("buku-buku berjalan", KAMUS), []);
    const t = cekTypo("buku-bukku berjalan", KAMUS);
    assert.equal(t.length, 1);
    assert.equal(t[0].kata, "bukku");
  });
});

describe("cekTypoGabungan", () => {
  it("temuan membawa label bagian Judul / Isi berita", () => {
    const t = cekTypoGabungan("Semarak Bakti", "Kegiatan berjaln lancar", KAMUS);
    assert.equal(t.length, 1);
    assert.equal(t[0].bagian, "Isi berita");
    assert.equal(t[0].kata, "berjaln");
  });
  it("judul dan isi yang benar menghasilkan 0 temuan", () => {
    assert.deepEqual(
      cekTypoGabungan("Semarak Hari Bakti Peduli Lingkungan", "Kegiatan lapas berjalan lancar", KAMUS),
      [],
    );
  });
});
