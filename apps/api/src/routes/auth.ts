import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { changePasswordSchema, loginSchema, totpCodeSchema, type MeResponse } from "@mc/shared";
import { centers, users } from "../db/schema";
import type { AppEnv } from "../env";
import { audit } from "../lib/audit";
import { ApiError } from "../lib/errors";
import { DUMMY_HASH, hashPassword, verifyPassword } from "../lib/password";
import * as rateLimit from "../lib/rate-limit";
import { open, seal } from "../lib/secret-box";
import { completeMfa, createSession, destroySession, revokeUserSessions, toSessionUser } from "../lib/session";
import { generateTotpSecret, otpauthUri, verifyTotp } from "../lib/totp";
import { validate } from "../lib/validate";
import { requireSession } from "../middleware/auth";

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS_PER_EMAIL = 5;
const MAX_FAILS_PER_IP = 20;
const MAX_MFA_FAILS = 5;
const TOTP_ISSUER = "Medical Center Platform";

export const authRoutes = new Hono<AppEnv>()
  .post(
    "/login",
    validate("json", loginSchema, "invalid_credentials"),
    async (c) => {
      const { email, password } = c.req.valid("json");
      const db = c.get("db");
      const ip = c.req.header("cf-connecting-ip") ?? "unknown";
      const emailKey = `login:email:${email}`;
      const ipKey = `login:ip:${ip}`;

      if (
        (await rateLimit.current(db, emailKey, WINDOW_MS)) >= MAX_FAILS_PER_EMAIL ||
        (await rateLimit.current(db, ipKey, WINDOW_MS)) >= MAX_FAILS_PER_IP
      ) {
        throw new ApiError(429, "too_many_attempts");
      }

      const user = await db.query.users.findFirst({ where: eq(users.email, email) });
      const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);

      if (!user || !ok || !user.isActive) {
        await rateLimit.hit(db, emailKey, WINDOW_MS);
        await rateLimit.hit(db, ipKey, WINDOW_MS);
        if (user) {
          await audit(c, { entity: "user", entityId: user.id, action: "login_failed", centerId: user.centerId, userId: user.id });
        }
        throw new ApiError(401, "invalid_credentials");
      }

      if (user.centerId) {
        const center = await db.query.centers.findFirst({ where: eq(centers.id, user.centerId) });
        if (center?.status !== "active") throw new ApiError(403, "center_suspended");
      }

      await rateLimit.clear(db, emailKey);
      await createSession(c, user);
      await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
      await audit(c, { entity: "user", entityId: user.id, action: "login", centerId: user.centerId, userId: user.id });

      const restriction =
        user.role === "super_admin" ? (user.totpSecret ? "mfa" : "mfa_setup") : user.mustChangePassword ? "password" : null;
      return c.json<MeResponse>({ user: toSessionUser(user), restriction });
    },
  )

  .post("/logout", async (c) => {
    await destroySession(c);
    return c.json({ ok: true });
  })

  .get("/me", requireSession, (c) => c.json<MeResponse>({ user: c.get("user")!, restriction: c.get("restriction") }))

  .post("/change-password", requireSession, validate("json", changePasswordSchema), async (c) => {
    if (c.get("restriction") === "mfa" || c.get("restriction") === "mfa_setup") throw new ApiError(403, "mfa_required");
    const { currentPassword, newPassword } = c.req.valid("json");
    const db = c.get("db");
    const me = c.get("user")!;
    const row = await db.query.users.findFirst({ where: eq(users.id, me.id) });
    if (!row || !(await verifyPassword(currentPassword, row.passwordHash))) {
      throw new ApiError(400, "wrong_current_password");
    }
    if (currentPassword === newPassword) throw new ApiError(400, "password_unchanged");
    await db
      .update(users)
      .set({ passwordHash: await hashPassword(newPassword), mustChangePassword: false })
      .where(eq(users.id, me.id));
    await revokeUserSessions(db, me.id, c.get("sessionId") ?? undefined);
    await audit(c, { entity: "user", entityId: me.id, action: "password_changed", centerId: me.centerId });
    return c.json({ ok: true });
  })

  /** Super admin, first sign-in: generate a TOTP secret to add to an authenticator app. */
  .post("/mfa/setup", requireSession, async (c) => {
    const me = c.get("user")!;
    if (me.role !== "super_admin") throw new ApiError(403, "forbidden");
    if (c.get("restriction") !== "mfa_setup") throw new ApiError(409, "mfa_already_enabled");
    const secret = generateTotpSecret();
    await c
      .get("db")
      .update(users)
      .set({ totpPendingSecret: await seal(secret, c.env.SECRETS_KEY) })
      .where(eq(users.id, me.id));
    return c.json({ secret, otpauthUri: otpauthUri(secret, me.email, TOTP_ISSUER) });
  })

  /** Super admin: confirm setup (first code) or complete sign-in with a code. */
  .post("/mfa/verify", requireSession, validate("json", totpCodeSchema), async (c) => {
    const me = c.get("user")!;
    const restriction = c.get("restriction");
    if (me.role !== "super_admin" || (restriction !== "mfa" && restriction !== "mfa_setup")) {
      throw new ApiError(409, "mfa_not_pending");
    }
    const db = c.get("db");
    const key = `mfa:user:${me.id}`;
    if ((await rateLimit.current(db, key, WINDOW_MS)) >= MAX_MFA_FAILS) throw new ApiError(429, "too_many_attempts");

    const row = (await db.query.users.findFirst({ where: eq(users.id, me.id) }))!;
    const sealed = restriction === "mfa" ? row.totpSecret : row.totpPendingSecret;
    if (!sealed) throw new ApiError(409, "mfa_setup_not_started");
    const secret = await open(sealed, c.env.SECRETS_KEY);
    const step = await verifyTotp(secret, c.req.valid("json").code, row.totpLastStep);
    if (step === null) {
      await rateLimit.hit(db, key, WINDOW_MS);
      await audit(c, { entity: "user", entityId: me.id, action: "mfa_failed", centerId: null });
      throw new ApiError(400, "invalid_code");
    }

    await db
      .update(users)
      .set(
        restriction === "mfa_setup"
          ? { totpSecret: sealed, totpPendingSecret: null, totpLastStep: step }
          : { totpLastStep: step },
      )
      .where(eq(users.id, me.id));
    await rateLimit.clear(db, key);
    await completeMfa(c, c.get("sessionId")!);
    await audit(c, { entity: "user", entityId: me.id, action: restriction === "mfa_setup" ? "mfa_enabled" : "mfa_verified", centerId: null });
    return c.json<MeResponse>({ user: me, restriction: null });
  });
