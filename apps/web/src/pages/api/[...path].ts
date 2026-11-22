import type { APIRoute } from "astro";
import { apiFetch, centerSlug } from "../../lib/api";

/**
 * Same-origin bridge for the browser:
 *   /api/public/<rest>  → API /api/public/<center-slug>/<rest>   (slots, bookings, requests)
 *   /api/media/<key>    → API /api/media/<key>                    (doctor photos, logo)
 * Only these two prefixes are forwarded. No cookies are sent onward.
 */
const ALLOWED_PUBLIC = /^public\/(doctors\/[\w-]+\/slots|bookings|requests)$/;
const ALLOWED_MEDIA = /^media\/c\/[\w-]+\/[\w/-]+\.(jpg|png|webp)$/;

const forward: APIRoute = async ({ params, request, url }) => {
  const path = params.path ?? "";
  let target: string;
  if (ALLOWED_PUBLIC.test(path)) target = `/api/public/${centerSlug()}/${path.slice("public/".length)}${url.search}`;
  else if (ALLOWED_MEDIA.test(path) && request.method === "GET") target = `/api/${path}`;
  else return new Response(JSON.stringify({ error: { code: "not_found" } }), { status: 404, headers: { "content-type": "application/json" } });

  if (request.method === "POST") {
    // Same-site check: browsers send Origin on POST.
    const origin = request.headers.get("origin");
    if (origin && origin !== url.origin) {
      return new Response(JSON.stringify({ error: { code: "bad_origin" } }), { status: 403, headers: { "content-type": "application/json" } });
    }
  }

  const headers = new Headers();
  const contentType = request.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  const ip = request.headers.get("cf-connecting-ip");
  if (ip) headers.set("cf-connecting-ip", ip);
  const body = request.method === "POST" ? await request.text() : undefined;
  if (body && body.length > 16_000) {
    return new Response(JSON.stringify({ error: { code: "too_large" } }), { status: 413, headers: { "content-type": "application/json" } });
  }

  const res = await apiFetch(target, { method: request.method, headers, body });
  const out = new Headers();
  for (const h of ["content-type", "cache-control", "etag"]) {
    const v = res.headers.get(h);
    if (v) out.set(h, v);
  }
  return new Response(res.body, { status: res.status, headers: out });
};

export const GET = forward;
export const POST = forward;
