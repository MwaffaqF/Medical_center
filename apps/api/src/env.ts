import type { SessionUser } from "@mc/shared";
import type { Database } from "./db/client";

export type Bindings = {
  DB: D1Database;
  ENVIRONMENT: "development" | "staging" | "production";
  /** Comma-separated extra origins allowed to send state-changing requests (e.g. the public website). */
  ALLOWED_ORIGINS?: string;
};

export type Variables = {
  db: Database;
  user: SessionUser | null;
  sessionId: string | null;
  /** The center this request acts on: the user's own center, or the support-mode center for a super admin. */
  centerId: string | null;
};

export type AppEnv = { Bindings: Bindings; Variables: Variables };
