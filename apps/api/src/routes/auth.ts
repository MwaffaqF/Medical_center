import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { loginSchema } from "@mc/shared";
import { centers, users } from "../db/schema";
import type { AppEnv } from "../env";
import { audit } from "../lib/audit";
import { ApiError } from "../lib/errors";
import { DUMMY_HASH, verifyPassword } from "../lib/password";
import * as rateLimit from "../lib/rate-limit";
import { createSession, destroySession, toSessionUser } from "../lib/session";
import { requireAuth } from "../middleware/auth";

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS_PER_EMAIL = 5;
const MAX_FAILS_PER_IP = 20;

export const authRoutes = new Hono<AppEnv>()
  .post(
    "/login",
    zValidator("json", loginSchema, (result) => {
      if (!result.success) throw new ApiError(400, "invalid_credentials");
    }),
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
      await createSession(c, user.id);
      await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
      await audit(c, { entity: "user", entityId: user.id, action: "login", centerId: user.centerId, userId: user.id });

      return c.json({ user: toSessionUser(user) });
    },
  )
  .post("/logout", async (c) => {
    await destroySession(c);
    return c.json({ ok: true });
  })
  .get("/me", requireAuth(), (c) => c.json({ user: c.get("user") }));
