import { createMiddleware } from "hono/factory";
import { IMAGE_TYPES } from "@mc/shared";
import type { AppEnv } from "../env";
import { ApiError } from "../lib/errors";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const ALLOWED_BODY_TYPES = ["application/json", ...IMAGE_TYPES];

/**
 * CSRF protection for cookie-authenticated requests:
 * - state-changing requests must send JSON or a raw image. HTML forms can only send
 *   form/multipart/text bodies, so cross-site form posts are rejected; any other type
 *   needs a CORS preflight, which this API never grants.
 * - if the browser sends an Origin header, it must be this site or an allowed origin.
 */
export const originGuard = createMiddleware<AppEnv>(async (c, next) => {
  if (!SAFE_METHODS.has(c.req.method)) {
    const contentType = (c.req.header("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    if (!ALLOWED_BODY_TYPES.includes(contentType)) throw new ApiError(415, "json_required");
    const origin = c.req.header("origin");
    if (origin) {
      const self = new URL(c.req.url).origin;
      const allowed = (c.env.ALLOWED_ORIGINS ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (origin !== self && !allowed.includes(origin)) throw new ApiError(403, "bad_origin");
    }
  }
  await next();
});
