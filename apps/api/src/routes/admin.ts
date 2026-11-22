import { and, count, desc, eq, isNotNull, ne, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import {
  centerAdminUpdateSchema,
  centerCreateSchema,
  supportModeSchema,
  userCreateSchema,
  userUpdateSchema,
} from "@mc/shared";
import { auditLog, centers, doctors, messageTemplates, users } from "../db/schema";
import { DEFAULT_TEMPLATES } from "../domain/default-templates";
import type { AppEnv } from "../env";
import { audit } from "../lib/audit";
import { ApiError } from "../lib/errors";
import { revokeUserSessions, setSupportCenter } from "../lib/session";
import { createStaffUser, publicUser, resetUserPassword } from "../lib/users";
import { validate } from "../lib/validate";
import { requireSuperAdmin } from "../middleware/auth";

/** Platform console API — super admin only. Spec §11.13. */
export const adminRoutes = new Hono<AppEnv>()
  .use("*", requireSuperAdmin)

  // ------------------------------------------------------------ centers
  .get("/centers", async (c) => {
    const db = c.get("db");
    const rows = await db
      .select({
        center: centers,
        // Fully qualified: inside a subquery a bare "id" would refer to the inner table.
        userCount: sql<number>`(select count(*) from users u where u.center_id = "centers"."id")`,
        doctorCount: sql<number>`(select count(*) from doctors d where d.center_id = "centers"."id")`,
      })
      .from(centers)
      .orderBy(centers.nameEn);
    return c.json({
      centers: rows.map((r) => ({ ...r.center, userCount: r.userCount, doctorCount: r.doctorCount })),
    });
  })

  .post("/centers", validate("json", centerCreateSchema), async (c) => {
    const input = c.req.valid("json");
    const db = c.get("db");
    if (await db.query.centers.findFirst({ where: eq(centers.slug, input.slug) })) throw new ApiError(409, "slug_taken");
    const [center] = await db.insert(centers).values(input).returning();
    await db.insert(messageTemplates).values(
      Object.entries(DEFAULT_TEMPLATES).map(([key, body]) => ({
        centerId: center!.id,
        key: key as keyof typeof DEFAULT_TEMPLATES,
        bodyAr: body.ar,
        bodyEn: body.en,
      })),
    );
    await audit(c, { entity: "center", entityId: center!.id, action: "create", changes: input, centerId: center!.id });
    return c.json({ center }, 201);
  })

  .get("/centers/:id", async (c) => {
    const center = await c.get("db").query.centers.findFirst({ where: eq(centers.id, c.req.param("id")) });
    if (!center) throw new ApiError(404, "not_found");
    return c.json({ center });
  })

  .patch("/centers/:id", validate("json", centerAdminUpdateSchema), async (c) => {
    const db = c.get("db");
    const id = c.req.param("id");
    const input = c.req.valid("json");
    const existing = await db.query.centers.findFirst({ where: eq(centers.id, id) });
    if (!existing) throw new ApiError(404, "not_found");
    if (input.slug && input.slug !== existing.slug) {
      if (await db.query.centers.findFirst({ where: eq(centers.slug, input.slug) })) throw new ApiError(409, "slug_taken");
    }
    const [center] = await db.update(centers).set(input).where(eq(centers.id, id)).returning();
    await audit(c, {
      entity: "center",
      entityId: id,
      action: input.status && input.status !== existing.status ? (input.status === "suspended" ? "suspend" : "reactivate") : "update",
      changes: input,
      centerId: id,
    });
    return c.json({ center });
  })

  // ------------------------------------------------------------ users
  .get("/centers/:id/users", async (c) => {
    const rows = await c.get("db").query.users.findMany({
      where: eq(users.centerId, c.req.param("id")),
      orderBy: [users.role, users.name],
    });
    return c.json({ users: rows.map(publicUser) });
  })

  .post("/centers/:id/users", validate("json", userCreateSchema), async (c) => {
    const db = c.get("db");
    const centerId = c.req.param("id");
    if (!(await db.query.centers.findFirst({ where: eq(centers.id, centerId) }))) throw new ApiError(404, "not_found");
    const input = c.req.valid("json");
    const result = await createStaffUser(db, centerId, input);
    await audit(c, {
      entity: "user",
      entityId: result.user.id,
      action: "create",
      changes: { email: input.email, role: input.role },
      centerId,
    });
    return c.json(result, 201);
  })

  .patch("/users/:id", validate("json", userUpdateSchema), async (c) => {
    const db = c.get("db");
    const target = await db.query.users.findFirst({ where: eq(users.id, c.req.param("id")) });
    if (!target || target.role === "super_admin") throw new ApiError(404, "not_found");
    const input = c.req.valid("json");
    const [user] = await db.update(users).set(input).where(eq(users.id, target.id)).returning();
    if (input.isActive === false) await revokeUserSessions(db, target.id);
    await audit(c, { entity: "user", entityId: target.id, action: "update", changes: input, centerId: target.centerId });
    return c.json({ user: publicUser(user!) });
  })

  .post("/users/:id/reset-password", async (c) => {
    const db = c.get("db");
    const target = await db.query.users.findFirst({ where: eq(users.id, c.req.param("id")) });
    if (!target || target.role === "super_admin") throw new ApiError(404, "not_found");
    const temporaryPassword = await resetUserPassword(db, target.id);
    await audit(c, { entity: "user", entityId: target.id, action: "password_reset", centerId: target.centerId });
    return c.json({ temporaryPassword });
  })

  // ------------------------------------------------------------ support mode
  .post("/support", validate("json", supportModeSchema), async (c) => {
    const db = c.get("db");
    const { centerId } = c.req.valid("json");
    const center = await db.query.centers.findFirst({ where: eq(centers.id, centerId) });
    if (!center) throw new ApiError(404, "not_found");
    await setSupportCenter(db, c.get("sessionId")!, centerId);
    // Logged against the center so its own audit history shows the access.
    await audit(c, { entity: "support", entityId: centerId, action: "support_start", centerId });
    return c.json({ ok: true, center: { id: center.id, nameAr: center.nameAr, nameEn: center.nameEn } });
  })

  .post("/support/exit", async (c) => {
    const current = c.get("user")!.supportCenterId;
    await setSupportCenter(c.get("db"), c.get("sessionId")!, null);
    if (current) await audit(c, { entity: "support", entityId: current, action: "support_end", centerId: current });
    return c.json({ ok: true });
  })

  // ------------------------------------------------------------ activity
  .get(
    "/activity",
    validate(
      "query",
      z.object({
        centerId: z.string().optional(),
        supportOnly: z.enum(["1", "0"]).optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50),
      }),
    ),
    async (c) => {
      const { centerId, supportOnly, limit } = c.req.valid("query");
      const filters = [
        centerId ? eq(auditLog.centerId, centerId) : undefined,
        supportOnly === "1" ? eq(auditLog.isSupportAction, true) : undefined,
      ].filter((f) => f !== undefined);
      const rows = await c
        .get("db")
        .select({
          id: auditLog.id,
          at: auditLog.at,
          centerId: auditLog.centerId,
          entity: auditLog.entity,
          entityId: auditLog.entityId,
          action: auditLog.action,
          isSupportAction: auditLog.isSupportAction,
          ip: auditLog.ip,
          userName: users.name,
          userEmail: users.email,
        })
        .from(auditLog)
        .leftJoin(users, eq(users.id, auditLog.userId))
        .where(filters.length ? and(...filters) : undefined)
        .orderBy(desc(auditLog.at))
        .limit(limit);
      return c.json({ activity: rows });
    },
  )

  .get("/stats", async (c) => {
    const db = c.get("db");
    const [centerCount] = await db.select({ n: count() }).from(centers);
    const [activeUsers] = await db
      .select({ n: count() })
      .from(users)
      .where(and(eq(users.isActive, true), ne(users.role, "super_admin")));
    const [recentLogins] = await db
      .select({ n: count() })
      .from(users)
      .where(and(isNotNull(users.lastLoginAt), sql`${users.lastLoginAt} > ${Date.now() - 7 * 86_400_000}`));
    return c.json({ centers: centerCount!.n, activeUsers: activeUsers!.n, usersSignedInLast7Days: recentLogins!.n });
  });
