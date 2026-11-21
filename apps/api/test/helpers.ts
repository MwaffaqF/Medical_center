import { env, exports } from "cloudflare:workers";
import type { Role } from "@mc/shared";
import { createDb } from "../src/db/client";
import { centers, users } from "../src/db/schema";
import { hashPassword } from "../src/lib/password";

export const BASE = "https://app.example.test";
export const db = () => createDb((env as unknown as { DB: D1Database }).DB);

export function call(path: string, init: RequestInit & { cookie?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  if (init.cookie) headers.set("cookie", init.cookie);
  const worker = (exports as unknown as { default: Fetcher }).default;
  return worker.fetch(new Request(BASE + path, { ...init, headers }));
}

export async function createCenter(slug = `c-${crypto.randomUUID().slice(0, 8)}`, status: "active" | "suspended" = "active") {
  const [center] = await db()
    .insert(centers)
    .values({ slug, status, nameAr: "مركز", nameEn: "Center" })
    .returning();
  return center!;
}

export async function createUser(opts: { email: string; password: string; role: Role; centerId: string | null; isActive?: boolean }) {
  // Low iteration count keeps tests fast; the format is the same as production.
  const passwordHash = await hashPassword(opts.password, 1000);
  const [user] = await db()
    .insert(users)
    .values({ name: "Test", email: opts.email, passwordHash, role: opts.role, centerId: opts.centerId, isActive: opts.isActive ?? true })
    .returning();
  return user!;
}

export async function login(email: string, password: string) {
  const res = await call("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
  const setCookie = res.headers.get("set-cookie") ?? "";
  const cookie = setCookie.split(";")[0] ?? "";
  return { res, cookie };
}
