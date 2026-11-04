import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const berita = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/berita' }),
  schema: z.object({
    title: z.string(),
    summary: z.string(),
    category: z.string(),
    tags: z.array(z.string()),
    author: z.string(),
    publishDate: z.coerce.date(),
    image: z.string(),
    imageCaption: z.string(),
    featured: z.boolean().default(false),
    breaking: z.boolean().default(false),
    upt: z.string().optional(),
    source: z.enum(['jurnalpas', 'contoh', 'zonapas']).default('contoh'),
    sourceUrl: z.string().optional(),
  }),
});

export const collections = { berita };
