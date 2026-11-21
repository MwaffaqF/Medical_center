import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { createDb } from "./db/client";
import type { AppEnv } from "./env";
import { ApiError } from "./lib/errors";
import { loadSession } from "./middleware/auth";
import { originGuard } from "./middleware/origin";
import { authRoutes } from "./routes/auth";

export const app = new Hono<AppEnv>().basePath("/api");

app.use("*", secureHeaders());
app.use("*", async (c, next) => {
  c.set("db", createDb(c.env.DB));
  c.header("Cache-Control", "no-store");
  await next();
});
app.use("*", originGuard);
app.use("*", loadSession);

app.get("/health", async (c) => {
  await c.env.DB.prepare("select 1").first();
  return c.json({ ok: true, environment: c.env.ENVIRONMENT });
});

app.route("/auth", authRoutes);

app.notFound((c) => c.json({ error: { code: "not_found" } }, 404));

app.onError((err, c) => {
  if (err instanceof ApiError) return c.json({ error: { code: err.code } }, err.status);
  console.error(err);
  return c.json({ error: { code: "internal_error" } }, 500);
});

export type AppType = typeof app;
