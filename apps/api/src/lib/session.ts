import { and, eq, gt, lt } from "drizzle-orm";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { SessionUser } from "@mc/shared";
import type { Database } from "../db/client";
import { centers, sessions, users } from "../db/schema";
import type { AppEnv } from "../env";
import { randomToken, sha256Hex } from "./tokens";

export const SESSION_COOKIE = "mc_session";
/** Sliding session lifetime. */
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
/** Extend the session when less than this remains. */
const RENEW_THRESHOLD_MS = SESSION_TTL_MS / 2;

export async function createSession(c: Context<AppEnv>, userId: string): Promise<string> {
  const token = randomToken();
  const id = await sha256Hex(token);
  await c.get("db").insert(sessions).values({
    id,
    userId,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    userAgent: c.req.header("user-agent")?.slice(0, 300) ?? null,
  });
  writeCookie(c, token);
  return id;
}

export async function destroySession(c: Context<AppEnv>): Promise<void> {
  const sessionId = c.get("sessionId");
  if (sessionId) await c.get("db").delete(sessions).where(eq(sessions.id, sessionId));
  deleteCookie(c, SESSION_COOKIE, { path: "/", secure: true });
}

type Resolved = { sessionId: string; user: SessionUser; centerId: string | null };

/** Look up the session from the cookie. Returns null when missing, expired, or the account is inactive. */
export async function resolveSession(c: Context<AppEnv>): Promise<Resolved | null> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return null;
  const db = c.get("db");
  const id = await sha256Hex(token);
  const now = Date.now();

  const row = await db
    .select({ session: sessions, user: users, centerStatus: centers.status })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .leftJoin(centers, eq(centers.id, users.centerId))
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, new Date(now))))
    .get();

  if (!row || !row.user.isActive) return null;
  if (row.user.role !== "super_admin" && row.centerStatus !== "active") return null;

  if (row.session.expiresAt.getTime() - now < RENEW_THRESHOLD_MS) {
    await db
      .update(sessions)
      .set({ expiresAt: new Date(now + SESSION_TTL_MS) })
      .where(eq(sessions.id, id));
    writeCookie(c, token);
  }

  const user = toSessionUser(row.user, row.session.supportCenterId);
  return { sessionId: id, user, centerId: user.centerId ?? user.supportCenterId };
}

export function toSessionUser(u: typeof users.$inferSelect, supportCenterId: string | null = null): SessionUser {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    centerId: u.centerId,
    supportCenterId: u.role === "super_admin" ? supportCenterId : null,
    preferredLocale: u.preferredLocale,
  };
}

export async function purgeExpiredSessions(db: Database): Promise<void> {
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
}

function writeCookie(c: Context<AppEnv>, token: string) {
  setCookie(c, SESSION_COOKIE, token, {
    path: "/",
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}
