import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { CATEGORIES, SITE, slugify } from '../data/site';
import { UPTS } from '../data/upt';

export const GET: APIRoute = async () => {
  const entries = await getCollection('berita');
  // lastmod halaman non-artikel (K7): tanggal artikel terbaru yang tampil
  // di halaman itu, atau tanggal build bila halaman tidak terikat artikel.
  const isoTgl = (d: Date) => d.toISOString().split('T')[0];
  const hariIni = isoTgl(new Date());
  const terbaru = (daftar: { data: { publishDate: Date } }[]) =>
    daftar.length ? isoTgl(new Date(Math.max(...daftar.map((e) => e.data.publishDate.getTime())))) : hariIni;
  const terbaruArtikel = terbaru(entries);
  const urls: { loc: string; lastmod?: string }[] = [
    { loc: `${SITE.url}/`, lastmod: terbaruArtikel },
    ...CATEGORIES.map((c) => ({
      loc: `${SITE.url}/${c.slug}/`,
      lastmod: terbaru(entries.filter((e) => e.data.category === c.name)),
    })),
    { loc: `${SITE.url}/upt/`, lastmod: terbaruArtikel },
    ...UPTS.map((u) => ({
      loc: `${SITE.url}/upt/${u.slug}/`,
      lastmod: terbaru(entries.filter((e) => e.data.upt === u.name)),
    })),
    { loc: `${SITE.url}/cari/`, lastmod: terbaruArtikel },
    { loc: `${SITE.url}/arsip/`, lastmod: terbaruArtikel },
    { loc: `${SITE.url}/tentang/`, lastmod: hariIni },
    { loc: `${SITE.url}/masuk/`, lastmod: hariIni },
    { loc: `${SITE.url}/redaksi/`, lastmod: hariIni },
    { loc: `${SITE.url}/pedoman-media-siber/`, lastmod: hariIni },
    { loc: `${SITE.url}/info-iklan/`, lastmod: hariIni },
    { loc: `${SITE.url}/kontak/`, lastmod: hariIni },
    { loc: `${SITE.url}/kebijakan-privasi/`, lastmod: hariIni },
    { loc: `${SITE.url}/disclaimer/`, lastmod: hariIni },
  ];
  for (const e of entries) {
    urls.push({
      loc: `${SITE.url}/berita/${e.id.replace(/\.md$/, '')}/`,
      lastmod: e.data.publishDate.toISOString().split('T')[0],
    });
  }
  // Halaman video + disclaimer (K2): entri video tanpa ID YouTube yang
  // valid tidak punya halaman (lihat getStaticPaths video/[slug].astro),
  // jadi tidak ikut masuk sitemap.
  const idYoutube = (tautan: string) => {
    const t = (tautan || '').trim();
    const m = t.match(/(?:v=|youtu\.be\/|shorts\/|embed\/|live\/)([A-Za-z0-9_-]{11})/) || t.match(/^([A-Za-z0-9_-]{11})$/);
    return m ? m[1] : '';
  };
  const videos = (await getCollection('video'))
    .filter((v) => idYoutube(v.data.video))
    .sort((a, b) => b.data.publishDate.getTime() - a.data.publishDate.getTime());
  urls.push({ loc: `${SITE.url}/video/`, lastmod: terbaru(videos) });
  for (const v of videos) {
    urls.push({
      loc: `${SITE.url}/video/${v.id.replace(/\.md$/, '')}/`,
      lastmod: v.data.publishDate.toISOString().split('T')[0],
    });
  }
  const tags = new Set<string>();
  for (const e of entries) for (const t of e.data.tags) tags.add(slugify(t));
  for (const t of tags)
    urls.push({
      loc: `${SITE.url}/tag/${t}/`,
      lastmod: terbaru(entries.filter((e) => e.data.tags.some((tag) => slugify(tag) === t))),
    });

  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
    .map(
      (u) =>
        `  <url><loc>${u.loc}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}</url>`
    )
    .join('\n')}\n</urlset>\n`;
  return new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
