import type { APIRoute } from "astro";

export const GET: APIRoute = ({ site, url }) => {
  const origin = (site ?? url).origin;
  const body = `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /ar/book/\nDisallow: /en/book/\n\nSitemap: ${origin}/sitemap.xml\n`;
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8" } });
};
