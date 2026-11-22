import { env } from "cloudflare:workers";
import type { BookingType } from "@mc/shared";

/**
 * Access to the API Worker.
 * - Deployed: through the `API` service binding (Worker-to-Worker, no public hop).
 * - Local development: over HTTP to API_ORIGIN (e.g. http://localhost:8787).
 */
type WebEnv = {
  API?: { fetch: (request: Request) => Promise<Response> };
  API_ORIGIN?: string;
  CENTER_SLUG?: string;
  TURNSTILE_SITE_KEY?: string;
  DASHBOARD_URL?: string;
};
export const webEnv = env as unknown as WebEnv;
export const centerSlug = () => webEnv.CENTER_SLUG ?? "pilot";

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  if (webEnv.API) return webEnv.API.fetch(new Request(`https://api.internal${path}`, init));
  const origin = webEnv.API_ORIGIN ?? "http://localhost:8787";
  return fetch(`${origin}${path}`, init);
}

const CACHE_SECONDS = 60;

/** GET a public JSON resource, cached at the edge for a minute. */
async function cachedJson<T>(path: string): Promise<{ status: number; data: T | null }> {
  const cache = (globalThis as unknown as { caches?: { default: Cache } }).caches?.default;
  const key = new Request(`https://web-cache.internal${path}`);
  const hit = await cache?.match(key).catch(() => undefined);
  const res = hit ?? (await apiFetch(path));
  if (!hit && res.ok && cache) {
    const copy = new Response(res.clone().body, res);
    copy.headers.set("Cache-Control", `public, max-age=${CACHE_SECONDS}`);
    await cache.put(key, copy).catch(() => undefined);
  }
  return { status: res.status, data: res.ok ? ((await res.json()) as T) : null };
}

// ---------------------------------------------------------------- types (public API shapes)

export type PublicService = { bookingType: BookingType; durationMinutes: number; price: number; notesAr: string | null; notesEn: string | null };
export type PublicDoctor = {
  id: string;
  slug: string;
  nameAr: string;
  nameEn: string;
  titleAr: string | null;
  titleEn: string | null;
  photoUrl: string | null;
  bioAr: string | null;
  bioEn: string | null;
  qualificationsAr: string | null;
  qualificationsEn: string | null;
  languages: string[];
  gender: "male" | "female" | null;
  yearsExperience: number | null;
  specialtyIds: string[];
  primarySpecialtyId: string | null;
  services: PublicService[];
};
export type PublicSpecialty = {
  id: string;
  slug: string;
  nameAr: string;
  nameEn: string;
  descriptionAr: string | null;
  descriptionEn: string | null;
  icon: string | null;
  doctorCount: number;
};
export type PublicCenter = {
  slug: string;
  status: "active" | "suspended";
  nameAr: string;
  nameEn: string;
  logoUrl: string | null;
  phone: string | null;
  whatsappPhone: string | null;
  addressAr: string | null;
  addressEn: string | null;
  mapUrl: string | null;
  openingHoursAr: string | null;
  openingHoursEn: string | null;
  aboutAr: string | null;
  aboutEn: string | null;
  timezone: string;
  currency: string;
  maxAdvanceDays: number;
};
export type Site = { center: PublicCenter; specialties: PublicSpecialty[]; doctors: PublicDoctor[] };

export async function getSite(): Promise<Site> {
  const { data } = await cachedJson<Site>(`/api/public/${centerSlug()}/site`);
  if (!data) throw new Error("site data unavailable");
  return data;
}
