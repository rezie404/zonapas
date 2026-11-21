// Harness uji konverter DD/MM/YYYY (21 Nov 2026).
// Mengekstrak fungsi dari berkas sumber lalu mengujinya, supaya harness
// tetap jalan walau berkas sumber berubah (tanpa file /tmp).
// Jalankan: node ~/workspace/zonapas/test-dmy-semua.mjs
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const DIR = path.dirname(fileURLToPath(import.meta.url));
function ambilFungsi(file, nama) {
  const src = fs.readFileSync(path.join(DIR, file), 'utf8');
  const i = src.indexOf('function ' + nama + '(');
  if (i < 0) throw new Error('fungsi ' + nama + ' tidak ketemu di ' + file);
  let j = src.indexOf('{', i), dalam = 0;
  for (let k = j; k < src.length; k++) {
    if (src[k] === '{') dalam++;
    else if (src[k] === '}') { dalam--; if (dalam === 0) return src.slice(i, k + 1); }
  }
  throw new Error('kurung tidak seimbang: ' + nama);
}
const kode = [
  ambilFungsi('public/kelola-umum.js', 'tanggalIsoKeDmy'),
  ambilFungsi('public/kelola-umum.js', 'tanggalDmyKeIso'),
  ambilFungsi('public/kelola-umum.js', 'tanggalFormatKetikDmy'),
  ambilFungsi('src/pages/cari.astro', 'cariIsoKeDmy'),
  ambilFungsi('src/pages/cari.astro', 'cariDmyKeIso'),
  ambilFungsi('src/pages/arsip.astro', 'arsipIsoKeDmy'),
  ambilFungsi('src/pages/arsip.astro', 'arsipDmyKeIso'),
].join('\n');
const fns = new Function(kode + '\nreturn { tanggalIsoKeDmy, tanggalDmyKeIso, tanggalFormatKetikDmy, cariIsoKeDmy, cariDmyKeIso, arsipIsoKeDmy, arsipDmyKeIso };')();
const { tanggalIsoKeDmy, tanggalDmyKeIso, tanggalFormatKetikDmy, cariIsoKeDmy, cariDmyKeIso, arsipIsoKeDmy, arsipDmyKeIso } = fns;
let lulus = 0, gagal = 0;
function cek(nama, nyata, harap) {
  const ok = JSON.stringify(nyata) === JSON.stringify(harap);
  if (ok) lulus++; else { gagal++; console.log('GAGAL:', nama, '->', JSON.stringify(nyata), 'harap', JSON.stringify(harap)); }
}
cek('iso 2026-11-21', tanggalIsoKeDmy('2026-11-21'), '21/11/2026');
cek('iso 2026-01-05', tanggalIsoKeDmy('2026-01-05'), '05/01/2026');
cek('iso kosong', tanggalIsoKeDmy(''), '');
cek('iso rusak', tanggalIsoKeDmy('21/11/2026'), '');
cek('cari iso', cariIsoKeDmy('2026-11-21'), '21/11/2026');
cek('arsip iso', arsipIsoKeDmy('2026-11-21'), '21/11/2026');
cek('dmy 21/11/2026', tanggalDmyKeIso('21/11/2026'), '2026-11-21');
cek('dmy 1/2/2026', tanggalDmyKeIso('1/2/2026'), '2026-02-01');
cek('dmy 05/01/2026', tanggalDmyKeIso('05/01/2026'), '2026-01-05');
cek('dmy 32/11/2026', tanggalDmyKeIso('32/11/2026'), null);
cek('dmy 31/02/2026', tanggalDmyKeIso('31/02/2026'), null);
cek('dmy 29/02/2026 bukan kabisat', tanggalDmyKeIso('29/02/2026'), null);
cek('dmy 29/02/2028 kabisat', tanggalDmyKeIso('29/02/2028'), '2028-02-29');
cek('dmy 21/13/2026', tanggalDmyKeIso('21/13/2026'), null);
cek('dmy 11/21/2026 (MM/DD salah masuk)', tanggalDmyKeIso('11/21/2026'), null);
cek('dmy kosong', tanggalDmyKeIso(''), null);
cek('dmy 2026-11-21 (ISO lolos)', tanggalDmyKeIso('2026-11-21'), '2026-11-21');
cek('cari dmy', cariDmyKeIso('21/11/2026'), '2026-11-21');
cek('arsip dmy', arsipDmyKeIso('21/11/2026'), '2026-11-21');
const el = { value: '' };
el.value = '21112026'; tanggalFormatKetikDmy(el); cek('ketik 21112026', el.value, '21/11/2026');
el.value = '2111'; tanggalFormatKetikDmy(el); cek('ketik 2111', el.value, '21/11');
el.value = '21'; tanggalFormatKetikDmy(el); cek('ketik 21', el.value, '21');
el.value = '21112026123'; tanggalFormatKetikDmy(el); cek('ketik >8 digit', el.value, '21/11/2026');
console.log(`\n${lulus} lulus, ${gagal} gagal`);
process.exit(gagal ? 1 : 0);
