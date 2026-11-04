// Generator cover SVG orisinal untuk artikel ZonaPas.
// Jalankan: node scripts/generate-covers.mjs
// Setiap cover: gradien warna kategori + huruf besar + nama kategori + wordmark ZonaPas.
import { writeFileSync, mkdirSync } from 'node:fs';

const covers = [
  ['cover-lapas-bengkulu-latih-warga-binaan-keterampilan-las-dan-pertukangan', 'Pembinaan', '#0A2540'],
  ['cover-lpka-bengkulu-bekali-anak-binaan-keterampilan-digital', 'Pembinaan', '#0A2540'],
  ['cover-warga-binaan-lapas-curup-panen-sayur-program-pertanian', 'Pembinaan', '#0A2540'],
  ['cover-rutan-bengkulu-gelar-razia-gabungan', 'Pengamanan', '#8B1E1E'],
  ['cover-lapas-arga-makmur-perkuat-pengamanan-patroli-cctv', 'Pengamanan', '#8B1E1E'],
  ['cover-petugas-lapas-perempuan-ikuti-pelatihan-penanganan-darurat', 'Pengamanan', '#8B1E1E'],
  ['cover-layanan-kunjungan-online-rutan-manna', 'Pelayanan', '#0E7C5B'],
  ['cover-bapas-bengkulu-percepat-layanan-litmas', 'Pelayanan', '#0E7C5B'],
  ['cover-lapas-bengkulu-buka-layanan-pengaduan-klinik-kesehatan', 'Pelayanan', '#0E7C5B'],
  ['cover-warga-binaan-lapas-arga-makmur-diusulkan-pembebasan-bersyarat', 'Integrasi & Remisi', '#7C3AED'],
  ['cover-bapas-bengkulu-dampingi-klien-asimilasi', 'Integrasi & Remisi', '#7C3AED'],
  ['cover-rutan-bengkulu-usulkan-remisi-warga-binaan', 'Integrasi & Remisi', '#7C3AED'],
  ['cover-kanwil-ditjenpas-bengkulu-pembinaan-mental-rohani-pegawai', 'Kepegawaian', '#B45309'],
  ['cover-petugas-pemasyarakatan-bengkulu-ikuti-diklat-kepemimpinan', 'Kepegawaian', '#B45309'],
  ['cover-lpka-bengkulu-perkuat-pembinaan-pegawai', 'Kepegawaian', '#B45309'],
  ['cover-kanwil-ditjenpas-bengkulu-gandeng-pemda-perkuat-pembinaan', 'Sinergi', '#0369A1'],
  ['cover-lapas-bengkulu-kerja-sama-dunia-usaha-serap-produk-warga-binaan', 'Sinergi', '#0369A1'],
  ['cover-bapas-bengkulu-sinergi-aparat-penegak-hukum', 'Sinergi', '#0369A1'],
  ['cover-lapas-perempuan-bengkulu-gelar-pameran-hasil-karya', 'Kegiatan UPT', '#15803D'],
  ['cover-rutan-manna-gelar-senam-olahraga-bersama', 'Kegiatan UPT', '#15803D'],
  ['cover-lapas-curup-peringati-hari-bakti-pemasyarakatan', 'Kegiatan UPT', '#15803D'],
  ['cover-mengenal-lapas-kelas-iia-bengkulu', 'Profil UPT', '#475569'],
  ['cover-mengenal-rutan-kelas-iib-manna', 'Profil UPT', '#475569'],
  ['cover-mengenal-bapas-kelas-i-bengkulu', 'Profil UPT', '#475569'],
  ['cover-cover-default', 'ZonaPas', '#0A2540'],
];

function svg(color, label, letter) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 675">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${color}"/>
      <stop offset="1" stop-color="#0A2540"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="675" fill="url(#g)"/>
  <circle cx="1050" cy="120" r="220" fill="#ffffff" opacity="0.06"/>
  <circle cx="1050" cy="120" r="140" fill="#ffffff" opacity="0.06"/>
  <circle cx="120" cy="580" r="160" fill="#ffffff" opacity="0.05"/>
  <text x="80" y="470" font-family="Arial, sans-serif" font-size="300" font-weight="900" fill="#ffffff" opacity="0.18">${letter}</text>
  <text x="80" y="560" font-family="Arial, sans-serif" font-size="44" font-weight="800" fill="#ffffff" letter-spacing="2">${label.toUpperCase()}</text>
  <text x="80" y="610" font-family="Arial, sans-serif" font-size="26" font-weight="700" fill="#ffffff" opacity="0.75">ZONAPAS</text>
  <rect x="80" y="630" width="120" height="8" rx="4" fill="#D9232E"/>
</svg>
`;
}

mkdirSync(new URL('../public/images', import.meta.url), { recursive: true });
for (const [name, label, color] of covers) {
  const letter = label.charAt(0);
  writeFileSync(new URL(`../public/images/${name}.svg`, import.meta.url), svg(color, label, letter));
  console.log('wrote', name + '.svg');
}
console.log('done:', covers.length, 'covers');
