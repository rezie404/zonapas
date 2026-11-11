import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { CATEGORIES, SITE, slugify } from '../data/site';
import { UPTS } from '../data/upt';

export const GET: APIRoute = async () => {
  const entries = await getCollection('berita');
  const urls: { loc: string; lastmod?: string }[] = [
    { loc: `${SITE.url}/` },
    ...CATEGORIES.map((c) => ({ loc: `${SITE.url}/${c.slug}/` })),
    { loc: `${SITE.url}/upt/` },
    ...UPTS.map((u) => ({ loc: `${SITE.url}/upt/${u.slug}/` })),
    { loc: `${SITE.url}/cari/` },
    { loc: `${SITE.url}/arsip/` },
    { loc: `${SITE.url}/tentang/` },
    { loc: `${SITE.url}/masuk/` },
    { loc: `${SITE.url}/redaksi/` },
    { loc: `${SITE.url}/pedoman-media-siber/` },
    { loc: `${SITE.url}/info-iklan/` },
    { loc: `${SITE.url}/kontak/` },
    { loc: `${SITE.url}/kebijakan-privasi/` },
  ];
  for (const e of entries) {
    urls.push({
      loc: `${SITE.url}/berita/${e.id.replace(/\.md$/, '')}/`,
      lastmod: e.data.publishDate.toISOString().split('T')[0],
    });
  }
  const tags = new Set<string>();
  for (const e of entries) for (const t of e.data.tags) tags.add(slugify(t));
  for (const t of tags) urls.push({ loc: `${SITE.url}/tag/${t}/` });

  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
    .map(
      (u) =>
        `  <url><loc>${u.loc}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}</url>`
    )
    .join('\n')}\n</urlset>\n`;
  return new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
