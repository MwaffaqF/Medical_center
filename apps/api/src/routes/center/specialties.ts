import { and, asc, eq, ne } from "drizzle-orm";
import { Hono } from "hono";
import { specialtySchema, specialtyUpdateSchema } from "@mc/shared";
import { specialties } from "../../db/schema";
import type { Database } from "../../db/client";
import type { AppEnv } from "../../env";
import { audit } from "../../lib/audit";
import { ApiError } from "../../lib/errors";
import { slugify, uniqueSlug } from "../../lib/slug";
import { validate } from "../../lib/validate";
import { centerOf, requireAuth } from "../../middleware/auth";

/** Specialties. Spec §11.9. No deletion: deactivate instead (keeps history intact). */
export const specialtyRoutes = new Hono<AppEnv>()
  .get("/", requireAuth(), async (c) => {
    const rows = await c.get("db").query.specialties.findMany({
      where: eq(specialties.centerId, centerOf(c)),
      orderBy: [asc(specialties.sortOrder), asc(specialties.nameEn)],
    });
    return c.json({ specialties: rows });
  })

  .post("/", requireAuth("manager"), validate("json", specialtySchema), async (c) => {
    const db = c.get("db");
    const centerId = centerOf(c);
    const input = c.req.valid("json");
    const slug = await resolveSlug(db, centerId, input.slug, input.nameEn);
    const [row] = await db.insert(specialties).values({ ...input, slug, centerId }).returning();
    await audit(c, { entity: "specialty", entityId: row!.id, action: "create", changes: input });
    return c.json({ specialty: row }, 201);
  })

  .patch("/:id", requireAuth("manager"), validate("json", specialtyUpdateSchema), async (c) => {
    const db = c.get("db");
    const centerId = centerOf(c);
    const id = c.req.param("id");
    const input = c.req.valid("json");
    const existing = await db.query.specialties.findFirst({ where: and(eq(specialties.id, id), eq(specialties.centerId, centerId)) });
    if (!existing) throw new ApiError(404, "not_found");
    if (input.slug && input.slug !== existing.slug) {
      const clash = await db.query.specialties.findFirst({
        where: and(eq(specialties.centerId, centerId), eq(specialties.slug, input.slug), ne(specialties.id, id)),
      });
      if (clash) throw new ApiError(409, "slug_taken");
    }
    const [row] = await db.update(specialties).set(input).where(eq(specialties.id, id)).returning();
    await audit(c, { entity: "specialty", entityId: id, action: "update", changes: input });
    return c.json({ specialty: row });
  });

async function resolveSlug(db: Database, centerId: string, requested: string | undefined, nameEn: string) {
  const taken = async (slug: string) =>
    !!(await db.query.specialties.findFirst({ where: and(eq(specialties.centerId, centerId), eq(specialties.slug, slug)) }));
  if (requested) {
    if (await taken(requested)) throw new ApiError(409, "slug_taken");
    return requested;
  }
  return uniqueSlug(slugify(nameEn), taken);
}
