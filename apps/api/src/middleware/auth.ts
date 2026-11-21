import { createMiddleware } from "hono/factory";
import type { Role } from "@mc/shared";
import type { AppEnv } from "../env";
import { ApiError } from "../lib/errors";
import { resolveSession } from "../lib/session";

/** Loads the session (if any) into c.var.user / c.var.centerId. Never rejects. */
export const loadSession = createMiddleware<AppEnv>(async (c, next) => {
  const resolved = await resolveSession(c);
  c.set("user", resolved?.user ?? null);
  c.set("sessionId", resolved?.sessionId ?? null);
  c.set("centerId", resolved?.centerId ?? null);
  await next();
});

/** Requires a signed-in user, optionally with one of the given roles. Super admin always passes. */
export const requireAuth = (...roles: Role[]) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const user = c.get("user");
    if (!user) throw new ApiError(401, "unauthenticated");
    if (roles.length && user.role !== "super_admin" && !roles.includes(user.role)) {
      throw new ApiError(403, "forbidden");
    }
    await next();
  });

/** Requires the request to be scoped to a center (staff user, or super admin in support mode). */
export const requireCenter = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.get("centerId")) throw new ApiError(400, "center_required");
  await next();
});

export const requireSuperAdmin = createMiddleware<AppEnv>(async (c, next) => {
  const user = c.get("user");
  if (!user) throw new ApiError(401, "unauthenticated");
  if (user.role !== "super_admin") throw new ApiError(403, "forbidden");
  await next();
});
