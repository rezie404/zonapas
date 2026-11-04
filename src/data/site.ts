export interface Category {
  name: string;
  slug: string;
  color: string;
  description: string;
}

export const CATEGORIES: Category[] = [
  { name: 'Pembinaan', slug: 'pembinaan', color: '#0A2540', description: 'Pembinaan warga binaan: kepribadian, kemandirian, dan program pembinaan di Lapas, Rutan, dan LPKA.' },
  { name: 'Pengamanan', slug: 'pengamanan', color: '#8B1E1E', description: 'Pengamanan dan intelijen pemasyarakatan: deteksi dini, pengawasan, dan kesiapsiagaan.' },
  { name: 'Pelayanan', slug: 'pelayanan', color: '#0E7C5B', description: 'Pelayanan pemasyarakatan: layanan kunjungan, hak warga binaan, dan layanan publik.' },
  { name: 'Integrasi & Remisi', slug: 'integrasi-remisi', color: '#7C3AED', description: 'Program integrasi (Pembebasan Bersyarat, Cuti Bersyarat) dan remisi bagi warga binaan.' },
  { name: 'Kepegawaian', slug: 'kepegawaian', color: '#B45309', description: 'Kepegawaian: pembinaan pegawai, disiplin, dan pengembangan SDM pemasyarakatan.' },
  { name: 'Sinergi', slug: 'sinergi', color: '#0369A1', description: 'Sinergi dan kerja sama Kanwil Ditjenpas Bengkulu dengan pemerintah daerah dan instansi lain.' },
  { name: 'Kegiatan UPT', slug: 'kegiatan-upt', color: '#15803D', description: 'Kegiatan dan liputan dari UPT Pemasyarakatan di lingkungan Kanwil Ditjenpas Bengkulu.' },
  { name: 'Profil UPT', slug: 'profil-upt', color: '#475569', description: 'Profil Unit Pelaksana Teknis Pemasyarakatan di Provinsi Bengkulu.' },
];

export function categoryByName(name: string): Category | undefined {
  return CATEGORIES.find((c) => c.name.toLowerCase() === name.toLowerCase());
}

export function categoryBySlug(slug: string): Category | undefined {
  return CATEGORIES.find((c) => c.slug === slug);
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('id-ID', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);
}

export function formatDateShort(date: Date): string {
  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

export function readingMinutes(body: string): number {
  const words = body.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

export const SITE = {
  name: 'ZonaPas',
  tagline: 'Melihat Pemasyarakatan Lebih Dekat',
  description:
    'ZonaPas — portal berita pemasyarakatan: pembinaan, pengamanan, pelayanan, integrasi dan remisi, serta kegiatan UPT Pemasyarakatan di lingkungan Kanwil Ditjenpas Bengkulu.',
  url: 'https://zonapas.web.id',
  email: 'redaksi@zonapas.web.id',
};
