import type { APIRoute } from 'astro';
import { SITE_ORIGIN, SITE_PAGES } from '../data/siteConfig';

export const prerender = true;

const escapeXml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${SITE_PAGES.map(({ href }) => `  <url><loc>${escapeXml(new URL(href, SITE_ORIGIN).toString())}</loc></url>`).join('\n')}
</urlset>
`;

export const GET: APIRoute = () =>
  new Response(sitemap, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
    },
  });
