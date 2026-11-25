import { Hono } from "hono";
import type { AppEnv } from "../env";
import type { MediaMetadata } from "../lib/media";

/**
 * Public images (doctor photos, logos). Keys contain a random UUID and never change,
 * so responses are cached for a year at the edge and in browsers (which also keeps
 * KV reads far below the free plan's daily allowance).
 */
export const mediaRoutes = new Hono<AppEnv>().get("/*", async (c) => {
  const key = c.req.path.replace(/^\/api\/media\//, "");
  if (!/^c\/[\w-]+\/[\w/-]+\.(jpg|png|webp)$/.test(key)) return c.json({ error: { code: "not_found" } }, 404);

  const cache = (globalThis as unknown as { caches?: { default: Cache } }).caches?.default;
  const cacheKey = new Request(new URL(c.req.path, c.req.url).toString());
  const cached = await cache?.match(cacheKey);
  if (cached) return new Response(cached.body, cached); // copy: cached responses have read-only headers

  const { value, metadata } = await c.env.MEDIA.getWithMetadata<MediaMetadata>(key, "stream");
  if (!value || !metadata) return c.json({ error: { code: "not_found" } }, 404);
  const headers = new Headers();
  headers.set("content-type", metadata.contentType);
  headers.set("cache-control", "public, max-age=31536000, immutable");
  headers.set("x-content-type-options", "nosniff");
  const res = new Response(value, { headers });
  if (cache) c.executionCtx.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
});
