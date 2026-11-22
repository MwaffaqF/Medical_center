import type { APIRoute } from "astro";
import { LOCALES } from "@mc/shared";
import { getSite } from "../lib/api";

export const GET: APIRoute = async ({ site: siteUrl, url }) => {
  const origin = (siteUrl ?? url).origin;
  const site = await getSite();
  const paths = ["/", "/specialties", "/doctors", "/book", "/privacy"];
  for (const s of site.specialties) paths.push(`/specialties/${s.slug}`);
  for (const d of site.doctors) paths.push(`/doctors/${d.slug}`);

  const entries = paths
    .map((p) => {
      const alternates = LOCALES.map((l) => `<xhtml:link rel="alternate" hreflang="${l}" href="${origin}/${l}${p}"/>`).join("");
      return LOCALES.map((l) => `<url><loc>${origin}/${l}${p}</loc>${alternates}</url>`).join("");
    })
    .join("");
  const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${entries}</urlset>`;
  return new Response(xml, { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" } });
};
