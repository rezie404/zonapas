export interface Upt {
  name: string;
  slug: string;
  type: string;
  description: string;
}

export const UPTS: Upt[] = [
  {
    name: 'Kanwil Ditjenpas Bengkulu',
    slug: 'kanwil-ditjenpas-bengkulu',
    type: 'Kantor Wilayah',
    description:
      'Kantor Wilayah Direktorat Jenderal Pemasyarakatan Bengkulu — membina, mengoordinasikan, dan mengawasi seluruh UPT Pemasyarakatan di Provinsi Bengkulu.',
  },
  {
    name: 'Lapas Kelas IIA Bengkulu',
    slug: 'lapas-kelas-iia-bengkulu',
    type: 'Lapas',
    description:
      'Lembaga Pemasyarakatan Kelas IIA di Kota Bengkulu — membina warga binaan melalui program pembinaan kepribadian dan kemandirian.',
  },
  {
    name: 'Lapas Kelas IIA Curup',
    slug: 'lapas-kelas-iia-curup',
    type: 'Lapas',
    description:
      'Lembaga Pemasyarakatan Kelas IIA di Kabupaten Rejang Lebong — membina warga binaan melalui program pembinaan kepribadian dan kemandirian.',
  },
  {
    name: 'Lapas Kelas IIB Arga Makmur',
    slug: 'lapas-kelas-iib-arga-makmur',
    type: 'Lapas',
    description:
      'Lembaga Pemasyarakatan Kelas IIB di Kabupaten Bengkulu Utara — membina warga binaan melalui program pembinaan kepribadian dan kemandirian.',
  },
  {
    name: 'Lapas Perempuan Kelas IIB Bengkulu',
    slug: 'lapas-perempuan-kelas-iib-bengkulu',
    type: 'Lapas',
    description:
      'Lembaga Pemasyarakatan Perempuan Kelas IIB di Kota Bengkulu — membina warga binaan perempuan melalui program pembinaan kepribadian dan kemandirian.',
  },
  {
    name: 'LPKA Kelas II Bengkulu',
    slug: 'lpka-kelas-ii-bengkulu',
    type: 'LPKA',
    description:
      'Lembaga Pembinaan Khusus Anak Kelas II di Kota Bengkulu — membina Anak Binaan melalui pendidikan, keterampilan, dan pembinaan kepribadian.',
  },
  {
    name: 'Rutan Kelas IIB Bengkulu',
    slug: 'rutan-kelas-iib-bengkulu',
    type: 'Rutan',
    description:
      'Rumah Tahanan Negara Kelas IIB di Kota Bengkulu — tempat penahanan tersangka/terdakwa sekaligus pembinaan warga binaan.',
  },
  {
    name: 'Rutan Kelas IIB Manna',
    slug: 'rutan-kelas-iib-manna',
    type: 'Rutan',
    description:
      'Rumah Tahanan Negara Kelas IIB di Kabupaten Bengkulu Selatan — tempat penahanan tersangka/terdakwa sekaligus pembinaan warga binaan.',
  },
  {
    name: 'Bapas Kelas I Bengkulu',
    slug: 'bapas-kelas-i-bengkulu',
    type: 'Bapas',
    description:
      'Balai Pemasyarakatan Kelas I di Kota Bengkulu — melaksanakan pembimbingan kemasyarakatan, penelitian kemasyarakatan (litmas), dan pengawasan klien pemasyarakatan.',
  },
];

export function uptByName(name: string): Upt | undefined {
  return UPTS.find((u) => u.name.toLowerCase() === name.toLowerCase());
}

export function uptBySlug(slug: string): Upt | undefined {
  return UPTS.find((u) => u.slug === slug);
}
