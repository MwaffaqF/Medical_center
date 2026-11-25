import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { centerSettingsSchema, templatesUpdateSchema } from "@mc/shared";
import { centers, messageTemplates } from "../../db/schema";
import type { AppEnv } from "../../env";
import { audit } from "../../lib/audit";
import { ApiError } from "../../lib/errors";
import { deleteMedia, storeImage } from "../../lib/media";
import { validate } from "../../lib/validate";
import { centerOf, requireAuth } from "../../middleware/auth";

/** Center settings and WhatsApp templates. Spec §11.10. Reading: all staff. Changing: manager. */
export const settingsRoutes = new Hono<AppEnv>()
  .get("/settings", requireAuth(), async (c) => {
    const center = await c.get("db").query.centers.findFirst({ where: eq(centers.id, centerOf(c)) });
    if (!center) throw new ApiError(404, "not_found");
    return c.json({ center });
  })

  .patch("/settings", requireAuth("manager"), validate("json", centerSettingsSchema), async (c) => {
    const input = c.req.valid("json");
    const [center] = await c.get("db").update(centers).set(input).where(eq(centers.id, centerOf(c))).returning();
    await audit(c, { entity: "center", entityId: center!.id, action: "update_settings", changes: input });
    return c.json({ center });
  })

  .put("/logo", requireAuth("manager"), async (c) => {
    const db = c.get("db");
    const id = centerOf(c);
    const existing = await db.query.centers.findFirst({ where: eq(centers.id, id) });
    const logoUrl = await storeImage(c, `c/${id}/logo`);
    await db.update(centers).set({ logoUrl }).where(eq(centers.id, id));
    await deleteMedia(c, existing?.logoUrl ?? null);
    await audit(c, { entity: "center", entityId: id, action: "update_logo" });
    return c.json({ logoUrl });
  })

  .get("/templates", requireAuth(), async (c) => {
    const templates = await c.get("db").query.messageTemplates.findMany({ where: eq(messageTemplates.centerId, centerOf(c)) });
    return c.json({ templates });
  })

  .put("/templates", requireAuth("manager"), validate("json", templatesUpdateSchema), async (c) => {
    const db = c.get("db");
    const centerId = centerOf(c);
    const { templates } = c.req.valid("json");
    await db.batch(
      templates.map((t) =>
        db
          .insert(messageTemplates)
          .values({ centerId, key: t.key, bodyAr: t.bodyAr, bodyEn: t.bodyEn })
          .onConflictDoUpdate({
            target: [messageTemplates.centerId, messageTemplates.key],
            set: { bodyAr: t.bodyAr, bodyEn: t.bodyEn, updatedAt: new Date() },
          }),
      ) as [never, ...never[]],
    );
    await audit(c, { entity: "message_templates", action: "update", changes: { keys: templates.map((t) => t.key) } });
    const rows = await db.query.messageTemplates.findMany({ where: and(eq(messageTemplates.centerId, centerId)) });
    return c.json({ templates: rows });
  });
