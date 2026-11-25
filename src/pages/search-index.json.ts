import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { formatDateShort, thumbCover, bandingkanBerita } from '../data/site';

export const GET: APIRoute = async () => {
  const entries = (await getCollection('berita')).sort(bandingkanBerita);
  const index = entries.map((e) => ({
    slug: e.id.replace(/\.md$/, ''),
    url: `/berita/${e.id.replace(/\.md$/, '')}/`,
    title: e.data.title,
    summary: e.data.summary,
    category: e.data.category,
    // UPT terkait artikel (dipakai tarikan Laporan Sepekan, 17 Nov 2026).
    upt: e.data.upt ?? null,
    tags: e.data.tags,
    author: e.data.author,
    date: formatDateShort(e.data.publishDate),
    tanggal: e.data.publishDate.toISOString().slice(0, 10),
    image: e.data.image,
    thumb: thumbCover(e.data.image, 640),
  }));
  return new Response(JSON.stringify(index), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
};
