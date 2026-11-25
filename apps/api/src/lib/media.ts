import type { Context } from "hono";
import { IMAGE_TYPES, MAX_IMAGE_BYTES } from "@mc/shared";
import type { AppEnv } from "../env";
import { ApiError } from "./errors";

const EXT: Record<(typeof IMAGE_TYPES)[number], string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** Public URL path for a stored object (served by GET /api/media/*). */
export const mediaUrl = (key: string) => `/api/media/${key}`;
export const keyFromUrl = (url: string | null) => (url?.startsWith("/api/media/") ? url.slice("/api/media/".length) : null);

/**
 * Stores the request body (a raw image, already resized by the dashboard) in R2.
 * Checks type, size and the file's magic bytes. Returns the public URL.
 */
export async function storeImage(c: Context<AppEnv>, prefix: string): Promise<string> {
  const type = (c.req.header("content-type") ?? "").split(";")[0]!.trim().toLowerCase() as (typeof IMAGE_TYPES)[number];
  if (!IMAGE_TYPES.includes(type)) throw new ApiError(415, "unsupported_image_type");
  const declared = Number(c.req.header("content-length") ?? "0");
  if (declared > MAX_IMAGE_BYTES) throw new ApiError(413, "image_too_large");
  const body = new Uint8Array(await c.req.arrayBuffer());
  if (body.byteLength === 0) throw new ApiError(400, "empty_image");
  if (body.byteLength > MAX_IMAGE_BYTES) throw new ApiError(413, "image_too_large");
  if (!matchesMagic(type, body)) throw new ApiError(415, "unsupported_image_type");

  const key = `${prefix}/${crypto.randomUUID()}.${EXT[type]}`;
  await c.env.MEDIA.put(key, body, { httpMetadata: { contentType: type, cacheControl: "public, max-age=31536000, immutable" } });
  return mediaUrl(key);
}

export async function deleteMedia(c: Context<AppEnv>, url: string | null): Promise<void> {
  const key = keyFromUrl(url);
  if (!key) return;
  await c.env.MEDIA.delete(key);
  // Drop this data center's cached copy too (other locations expire naturally; the URL is no longer referenced).
  const cache = (globalThis as unknown as { caches?: { default: Cache } }).caches?.default;
  await cache?.delete(new URL(url!, c.req.url).toString());
}

function matchesMagic(type: string, b: Uint8Array): boolean {
  if (type === "image/jpeg") return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  if (type === "image/png") return b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
  if (type === "image/webp") {
    const s = (i: number, n: number) => String.fromCharCode(...b.slice(i, i + n));
    return s(0, 4) === "RIFF" && s(8, 4) === "WEBP";
  }
  return false;
}
