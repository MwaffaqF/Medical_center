import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { createDb } from "./db/client";
import type { AppEnv } from "./env";
import { ApiError } from "./lib/errors";
import { ValidationError } from "./lib/validate";
import { loadSession, requireAuth, requireCenter } from "./middleware/auth";
import { originGuard } from "./middleware/origin";
import { adminRoutes } from "./routes/admin";
import { authRoutes } from "./routes/auth";
import { doctorRoutes } from "./routes/center/doctors";
import { settingsRoutes } from "./routes/center/settings";
import { specialtyRoutes } from "./routes/center/specialties";
import { centerUserRoutes } from "./routes/center/users";
import { mediaRoutes } from "./routes/media";

export const app = new Hono<AppEnv>().basePath("/api");

app.use("*", secureHeaders({ crossOriginResourcePolicy: "same-site" }));
app.use("*", async (c, next) => {
  c.set("db", createDb(c.env.DB));
  await next();
  if (!c.req.path.startsWith("/api/media/")) c.header("Cache-Control", "no-store");
});

// Public images: no session lookup needed.
app.route("/media", mediaRoutes);

app.use("*", originGuard);
app.use("*", loadSession);

app.get("/health", async (c) => {
  await c.env.DB.prepare("select 1").first();
  return c.json({ ok: true, environment: c.env.ENVIRONMENT });
});

app.route("/auth", authRoutes);
app.route("/admin", adminRoutes);

// Center-scoped routes: staff of a center, or the super admin in support mode.
app.use("/center/*", requireAuth(), requireCenter);
app.route("/center", settingsRoutes);
app.route("/center/users", centerUserRoutes);
app.route("/center/specialties", specialtyRoutes);
app.route("/center/doctors", doctorRoutes);

app.notFound((c) => c.json({ error: { code: "not_found" } }, 404));

app.onError((err, c) => {
  if (err instanceof ValidationError) return c.json({ error: { code: err.code, fields: err.fields } }, 400);
  if (err instanceof ApiError) return c.json({ error: { code: err.code } }, err.status);
  console.error(err);
  return c.json({ error: { code: "internal_error" } }, 500);
});

export type AppType = typeof app;
