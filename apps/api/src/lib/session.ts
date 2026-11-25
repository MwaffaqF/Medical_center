import { and, eq, gt, lt, ne } from "drizzle-orm";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { SessionRestriction, SessionUser } from "@mc/shared";
import type { Database } from "../db/client";
import { centers, sessions, users } from "../db/schema";
import type { AppEnv } from "../env";
import { randomToken, sha256Hex } from "./tokens";

export const SESSION_COOKIE = "mc_session";
/** Sliding session lifetime. */
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
/** A session waiting for a 2FA code expires quickly. */
const MFA_PENDING_TTL_MS = 10 * 60 * 1000;
/** Extend the session when less than this remains. */
const RENEW_THRESHOLD_MS = SESSION_TTL_MS / 2;

type UserRow = typeof users.$inferSelect;

export async function createSession(c: Context<AppEnv>, user: UserRow): Promise<string> {
  const token = randomToken();
  const id = await sha256Hex(token);
  const mfaPending = user.role === "super_admin";
  const ttl = mfaPending ? MFA_PENDING_TTL_MS : SESSION_TTL_MS;
  await c.get("db").insert(sessions).values({
    id,
    userId: user.id,
    mfaPending,
    expiresAt: new Date(Date.now() + ttl),
    userAgent: c.req.header("user-agent")?.slice(0, 300) ?? null,
  });
  writeCookie(c, token, ttl);
  return id;
}

/** Marks a super admin session as fully signed in after a valid 2FA code. */
export async function completeMfa(c: Context<AppEnv>, sessionId: string): Promise<void> {
  await c
    .get("db")
    .update(sessions)
    .set({ mfaPending: false, expiresAt: new Date(Date.now() + SESSION_TTL_MS) })
    .where(eq(sessions.id, sessionId));
  const token = getCookie(c, SESSION_COOKIE);
  if (token) writeCookie(c, token, SESSION_TTL_MS);
}

export async function destroySession(c: Context<AppEnv>): Promise<void> {
  const sessionId = c.get("sessionId");
  if (sessionId) await c.get("db").delete(sessions).where(eq(sessions.id, sessionId));
  deleteCookie(c, SESSION_COOKIE, { path: "/", secure: true });
}

/** Signs a user out everywhere (e.g. after deactivation or a password reset). */
export async function revokeUserSessions(db: Database, userId: string, exceptSessionId?: string): Promise<void> {
  await db
    .delete(sessions)
    .where(exceptSessionId ? and(eq(sessions.userId, userId), ne(sessions.id, exceptSessionId)) : eq(sessions.userId, userId));
}

export async function setSupportCenter(db: Database, sessionId: string, centerId: string | null): Promise<void> {
  await db.update(sessions).set({ supportCenterId: centerId }).where(eq(sessions.id, sessionId));
}

type Resolved = {
  sessionId: string;
  user: SessionUser;
  centerId: string | null;
  restriction: SessionRestriction;
};

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

  let restriction: SessionRestriction = null;
  if (row.session.mfaPending) restriction = row.user.totpSecret ? "mfa" : "mfa_setup";
  else if (row.user.mustChangePassword) restriction = "password";

  if (!row.session.mfaPending && row.session.expiresAt.getTime() - now < RENEW_THRESHOLD_MS) {
    await db
      .update(sessions)
      .set({ expiresAt: new Date(now + SESSION_TTL_MS) })
      .where(eq(sessions.id, id));
    writeCookie(c, token, SESSION_TTL_MS);
  }

  const user = toSessionUser(row.user, row.session.supportCenterId);
  return {
    sessionId: id,
    user,
    restriction,
    centerId: restriction ? null : (user.centerId ?? user.supportCenterId),
  };
}

export function toSessionUser(u: UserRow, supportCenterId: string | null = null): SessionUser {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    centerId: u.centerId,
    supportCenterId: u.role === "super_admin" ? supportCenterId : null,
    preferredLocale: u.preferredLocale,
    mustChangePassword: u.mustChangePassword,
  };
}

export async function purgeExpiredSessions(db: Database): Promise<void> {
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
}

function writeCookie(c: Context<AppEnv>, token: string, ttlMs: number) {
  setCookie(c, SESSION_COOKIE, token, {
    path: "/",
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    maxAge: Math.floor(ttlMs / 1000),
  });
}
