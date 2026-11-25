import type { Context } from "hono";
import type { AppEnv } from "../env";
import { ApiError } from "./errors";

/**
 * Cloudflare Turnstile bot check for public forms (spec §10).
 * Without TURNSTILE_SECRET the check is skipped in development and tests, and refused in production.
 * Test keys (always pass): site key 1x00000000000000000000AA, secret 1x0000000000000000000000000000000AA.
 */
export async function verifyTurnstile(c: Context<AppEnv>, token: string | undefined): Promise<void> {
  const secret = c.env.TURNSTILE_SECRET;
  if (!secret) {
    if (c.env.ENVIRONMENT === "production") throw new ApiError(500, "turnstile_not_configured");
    return;
  }
  if (!token) throw new ApiError(400, "bot_check_failed");
  const body = new FormData();
  body.append("secret", secret);
  body.append("response", token);
  const ip = c.req.header("cf-connecting-ip");
  if (ip) body.append("remoteip", ip);
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
  const result = (await res.json().catch(() => ({ success: false }))) as { success: boolean };
  if (!result.success) throw new ApiError(400, "bot_check_failed");
}
