import type { SessionRestriction, SessionUser } from "@mc/shared";
import type { Database } from "./db/client";

export type Bindings = {
  DB: D1Database;
  /** Workers KV namespace for doctor photos and center logos (free plan, no payment card needed). */
  MEDIA: KVNamespace;
  ENVIRONMENT: "development" | "staging" | "production";
  /** Base64 32-byte key for encrypting TOTP secrets (Worker secret; .dev.vars locally). */
  SECRETS_KEY?: string;
  /** Cloudflare Turnstile secret for public forms (Worker secret). Optional outside production. */
  TURNSTILE_SECRET?: string;
  /** Comma-separated extra origins allowed to send state-changing requests (e.g. the public website). */
  ALLOWED_ORIGINS?: string;
};

export type Variables = {
  db: Database;
  user: SessionUser | null;
  sessionId: string | null;
  /** Set when the session exists but can't be used yet (2FA or password change pending). */
  restriction: SessionRestriction;
  /** The center this request acts on: the user's own center, or the support-mode center for a super admin. */
  centerId: string | null;
};

export type AppEnv = { Bindings: Bindings; Variables: Variables };
