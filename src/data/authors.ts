export interface Author {
  name: string;
  role: string;
  bio: string;
}

export const AUTHORS: Record<string, Author> = {
  'Redaksi ZonaPas': {
    name: 'Redaksi ZonaPas',
    role: 'Tim Redaksi',
    bio: 'Tim redaksi ZonaPas yang menyusun berita pemasyarakatan dari berbagai sumber terpercaya.',
  },
  'Rezie Novian Putra': {
    name: 'Rezie Novian Putra',
    role: 'JurnalPAS',
    bio: 'Pengelola JurnalPAS, media online berita pemasyarakatan. Artikelnya diterbitkan ulang di ZonaPas dengan atribusi sumber.',
  },
  'Andi Pratama': {
    name: 'Andi Pratama',
    role: 'Jurnalis',
    bio: 'Jurnalis ZonaPas yang meliput pembinaan, pengamanan, dan kegiatan UPT Pemasyarakatan.',
  },
  'Sari Wulandari': {
    name: 'Sari Wulandari',
    role: 'Jurnalis',
    bio: 'Jurnalis ZonaPas yang meliput pelayanan, integrasi dan remisi, serta sinergi pemasyarakatan.',
  },
  'Budi Santoso': {
    name: 'Budi Santoso',
    role: 'Jurnalis',
    bio: 'Jurnalis ZonaPas yang meliput kepegawaian, profil UPT, dan kegiatan pemasyarakatan.',
  },
};

export function getAuthor(name: string): Author {
  return AUTHORS[name] ?? { name, role: 'Kontributor', bio: '' };
}
