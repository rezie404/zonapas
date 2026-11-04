import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { SITE } from '../data/site';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export const GET: APIRoute = async () => {
  const entries = (await getCollection('berita'))
    .sort((a, b) => b.data.publishDate.getTime() - a.data.publishDate.getTime())
    .slice(0, 20);
  const items = entries
    .map(
      (e) => `    <item>
      <title>${esc(e.data.title)}</title>
      <link>${SITE.url}/berita/${e.id.replace(/\.md$/, '')}/</link>
      <guid>${SITE.url}/berita/${e.id.replace(/\.md$/, '')}/</guid>
      <description>${esc(e.data.summary)}</description>
      <pubDate>${e.data.publishDate.toUTCString()}</pubDate>
      <category>${esc(e.data.category)}</category>
    </item>`
    )
    .join('\n');
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0">\n  <channel>\n    <title>${esc(SITE.name)} — ${esc(SITE.tagline)}</title>\n    <link>${SITE.url}/</link>\n    <description>${esc(SITE.description)}</description>\n    <language>id-ID</language>\n${items}\n  </channel>\n</rss>\n`;
  return new Response(body, { headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' } });
};
