import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const berita = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/berita' }),
  schema: z.object({
    title: z.string(),
    summary: z.string(),
    category: z.string(),
    tags: z.array(z.string()).default([]),
    author: z.string(),
    publishDate: z.coerce.date(),
    image: z.string(),
    imageCaption: z.string(),
    featured: z.boolean().default(false),
    breaking: z.boolean().default(false),
    breakingSince: z.string().optional(),
    upt: z.string().optional(),
    source: z.enum(['jurnalpas', 'contoh', 'zonapas']).default('contoh'),
    sourceUrl: z.string().optional(),
    // Foto profil penulis dari Google (hanya Penulis/Penyunting; artikel
    // Administrator tidak membawa field ini — tetap lingkaran huruf awal).
    authorImage: z.string().optional(),
    // ID post padanan di JurnalPas (ditulis backfill + Action sync; dipakai
    // untuk memperbarui post yang sama, bukan membuat duplikat).
    jurnalpas_id: z.number().optional(),
  }),
});

// ZonaPasTV: video YouTube redaksi (dikelola lewat Kelola Berita,
// cadangan lewat Decap). `video` berisi tautan YouTube (watch / youtu.be /
// Shorts); video tetap tersimpan di YouTube, situs hanya menanamkannya.
// Poster opsional — bila kosong, sampul memakai gambar mini YouTube.
const video = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/video' }),
  schema: z.object({
    title: z.string(),
    description: z.string().default(''),
    video: z.string(),
    poster: z.string().optional(),
    publishDate: z.coerce.date(),
    author: z.string().default('Rezie'),
  }),
});

export const collections = { berita, video };
