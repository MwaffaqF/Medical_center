import { createMiddleware } from "hono/factory";
import type { Role } from "@mc/shared";
import type { AppEnv } from "../env";
import { ApiError } from "../lib/errors";
import { resolveSession } from "../lib/session";

/** Loads the session (if any) into c.var. Never rejects. */
export const loadSession = createMiddleware<AppEnv>(async (c, next) => {
  const resolved = await resolveSession(c);
  c.set("user", resolved?.user ?? null);
  c.set("sessionId", resolved?.sessionId ?? null);
  c.set("restriction", resolved?.restriction ?? null);
  c.set("centerId", resolved?.centerId ?? null);
  await next();
});

/** Any session, including one still waiting for 2FA or a password change. */
export const requireSession = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.get("user")) throw new ApiError(401, "unauthenticated");
  await next();
});

/**
 * A fully signed-in user, optionally with one of the given roles.
 * The super admin always passes the role check.
 */
export const requireAuth = (...roles: Role[]) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const user = c.get("user");
    if (!user) throw new ApiError(401, "unauthenticated");
    const restriction = c.get("restriction");
    if (restriction === "mfa" || restriction === "mfa_setup") throw new ApiError(403, "mfa_required");
    if (restriction === "password") throw new ApiError(403, "password_change_required");
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
  if (c.get("restriction")) throw new ApiError(403, "mfa_required");
  if (user.role !== "super_admin") throw new ApiError(403, "forbidden");
  await next();
});

/** The center id for a center-scoped route (call only after requireCenter). */
export const centerOf = (c: { get: (k: "centerId") => string | null }): string => {
  const id = c.get("centerId");
  if (!id) throw new ApiError(400, "center_required");
  return id;
};
