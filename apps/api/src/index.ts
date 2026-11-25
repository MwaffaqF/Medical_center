import { app } from "./app";
import { createDb } from "./db/client";
import type { Bindings } from "./env";
import { purgeExpiredSessions } from "./lib/session";

/**
 * One Worker serves the API (/api/*) and the dashboard's static files (everything else,
 * via the assets binding with SPA fallback). Same origin = simple, secure cookies.
 */
export default {
  fetch: app.fetch,
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(purgeExpiredSessions(createDb(env.DB)));
  },
} satisfies ExportedHandler<Bindings>;
