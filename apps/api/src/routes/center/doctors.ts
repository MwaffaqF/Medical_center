import { and, asc, eq, inArray, ne, notInArray } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { doctorSchema, doctorServicesSchema, doctorUpdateSchema } from "@mc/shared";
import type { Database } from "../../db/client";
import { doctorServices, doctors, doctorSpecialties, specialties } from "../../db/schema";
import type { AppEnv } from "../../env";
import { audit } from "../../lib/audit";
import { ApiError } from "../../lib/errors";
import { deleteMedia, storeImage } from "../../lib/media";
import { slugify, uniqueSlug } from "../../lib/slug";
import { validate } from "../../lib/validate";
import { centerOf, requireAuth } from "../../middleware/auth";

type DoctorRow = typeof doctors.$inferSelect;

/**
 * Doctors, their specialties, booking types (length + price) and photo. Spec §11.8.
 * No deletion: deactivate instead (appointments reference doctors).
 */
export const doctorRoutes = new Hono<AppEnv>()
  .get("/", requireAuth(), async (c) => {
    const db = c.get("db");
    const centerId = centerOf(c);
    const rows = await db.query.doctors.findMany({
      where: eq(doctors.centerId, centerId),
      orderBy: [asc(doctors.sortOrder), asc(doctors.nameEn)],
    });
    return c.json({ doctors: await withRelations(db, rows) });
  })

  .get("/:id", requireAuth(), async (c) => {
    const doctor = await findDoctor(c);
    const [full] = await withRelations(c.get("db"), [doctor]);
    return c.json({ doctor: full });
  })

  .post("/", requireAuth("manager"), validate("json", doctorSchema), async (c) => {
    const db = c.get("db");
    const centerId = centerOf(c);
    const { specialtyIds, primarySpecialtyId, slug: requestedSlug, ...fields } = c.req.valid("json");
    await assertSpecialties(db, centerId, specialtyIds, primarySpecialtyId);
    const slug = await resolveSlug(db, centerId, requestedSlug, fields.nameEn);
    const [doctor] = await db.insert(doctors).values({ ...fields, slug, centerId }).returning();
    await replaceSpecialties(db, doctor!.id, specialtyIds, primarySpecialtyId);
    await audit(c, { entity: "doctor", entityId: doctor!.id, action: "create", changes: { ...fields, specialtyIds } });
    const [full] = await withRelations(db, [doctor!]);
    return c.json({ doctor: full }, 201);
  })

  .patch("/:id", requireAuth("manager"), validate("json", doctorUpdateSchema), async (c) => {
    const db = c.get("db");
    const centerId = centerOf(c);
    const existing = await findDoctor(c);
    const { specialtyIds, primarySpecialtyId, slug, ...fields } = c.req.valid("json");
    if (slug && slug !== existing.slug) {
      const clash = await db.query.doctors.findFirst({
        where: and(eq(doctors.centerId, centerId), eq(doctors.slug, slug), ne(doctors.id, existing.id)),
      });
      if (clash) throw new ApiError(409, "slug_taken");
    }
    if (specialtyIds) await assertSpecialties(db, centerId, specialtyIds, primarySpecialtyId ?? null);
    const [doctor] = await db
      .update(doctors)
      .set({ ...fields, ...(slug ? { slug } : {}) })
      .where(eq(doctors.id, existing.id))
      .returning();
    if (specialtyIds) await replaceSpecialties(db, existing.id, specialtyIds, primarySpecialtyId ?? null);
    await audit(c, { entity: "doctor", entityId: existing.id, action: "update", changes: c.req.valid("json") });
    const [full] = await withRelations(db, [doctor!]);
    return c.json({ doctor: full });
  })

  /** Replace the doctor's booking types. Types left out are removed (existing appointments keep their price snapshot). */
  .put("/:id/services", requireAuth("manager"), validate("json", doctorServicesSchema), async (c) => {
    const db = c.get("db");
    const centerId = centerOf(c);
    const doctor = await findDoctor(c);
    const { services } = c.req.valid("json");
    const keep = services.map((s) => s.bookingType);
    await db.batch([
      db
        .delete(doctorServices)
        .where(
          keep.length
            ? and(eq(doctorServices.doctorId, doctor.id), notInArray(doctorServices.bookingType, keep))
            : eq(doctorServices.doctorId, doctor.id),
        ),
      ...services.map((s) =>
        db
          .insert(doctorServices)
          .values({ ...s, doctorId: doctor.id, centerId })
          .onConflictDoUpdate({
            target: [doctorServices.doctorId, doctorServices.bookingType],
            set: {
              durationMinutes: s.durationMinutes,
              price: s.price,
              isActive: s.isActive,
              notesAr: s.notesAr,
              notesEn: s.notesEn,
              updatedAt: new Date(),
            },
          }),
      ),
    ]);
    await audit(c, { entity: "doctor", entityId: doctor.id, action: "update_services", changes: { services } });
    const [full] = await withRelations(db, [doctor]);
    return c.json({ doctor: full });
  })

  .put("/:id/photo", requireAuth("manager"), async (c) => {
    const db = c.get("db");
    const doctor = await findDoctor(c);
    const photoUrl = await storeImage(c, `c/${doctor.centerId}/doctors/${doctor.id}`);
    await db.update(doctors).set({ photoUrl }).where(eq(doctors.id, doctor.id));
    await deleteMedia(c, doctor.photoUrl);
    await audit(c, { entity: "doctor", entityId: doctor.id, action: "update_photo" });
    return c.json({ photoUrl });
  })

  .delete("/:id/photo", requireAuth("manager"), async (c) => {
    const doctor = await findDoctor(c);
    await c.get("db").update(doctors).set({ photoUrl: null }).where(eq(doctors.id, doctor.id));
    await deleteMedia(c, doctor.photoUrl);
    await audit(c, { entity: "doctor", entityId: doctor.id, action: "remove_photo" });
    return c.json({ ok: true });
  });

async function findDoctor(c: Context<AppEnv>): Promise<DoctorRow> {
  const doctor = await c.get("db").query.doctors.findFirst({
    where: and(eq(doctors.id, c.req.param("id")!), eq(doctors.centerId, centerOf(c))),
  });
  if (!doctor) throw new ApiError(404, "not_found");
  return doctor;
}

async function assertSpecialties(db: Database, centerId: string, ids: string[], primaryId: string | null) {
  const unique = [...new Set(ids)];
  if (primaryId && !unique.includes(primaryId)) throw new ApiError(400, "primary_specialty_not_selected");
  if (!unique.length) return;
  const found = await db
    .select({ id: specialties.id })
    .from(specialties)
    .where(and(eq(specialties.centerId, centerId), inArray(specialties.id, unique)));
  if (found.length !== unique.length) throw new ApiError(400, "unknown_specialty");
}

async function replaceSpecialties(db: Database, doctorId: string, ids: string[], primaryId: string | null) {
  const unique = [...new Set(ids)];
  const primary = primaryId ?? unique[0] ?? null;
  await db.batch([
    db.delete(doctorSpecialties).where(eq(doctorSpecialties.doctorId, doctorId)),
    ...unique.map((specialtyId) =>
      db.insert(doctorSpecialties).values({ doctorId, specialtyId, isPrimary: specialtyId === primary }),
    ),
  ]);
}

async function withRelations(db: Database, rows: DoctorRow[]) {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [links, services] = await Promise.all([
    db.select().from(doctorSpecialties).where(inArray(doctorSpecialties.doctorId, ids)),
    db.select().from(doctorServices).where(inArray(doctorServices.doctorId, ids)),
  ]);
  const order = { visit: 0, revisit: 1, session: 2 } as const;
  return rows.map((d) => {
    const mine = links.filter((l) => l.doctorId === d.id);
    return {
      ...d,
      specialtyIds: mine.map((l) => l.specialtyId),
      primarySpecialtyId: mine.find((l) => l.isPrimary)?.specialtyId ?? null,
      services: services
        .filter((s) => s.doctorId === d.id)
        .sort((a, b) => order[a.bookingType] - order[b.bookingType]),
    };
  });
}

async function resolveSlug(db: Database, centerId: string, requested: string | undefined, nameEn: string) {
  const taken = async (slug: string) =>
    !!(await db.query.doctors.findFirst({ where: and(eq(doctors.centerId, centerId), eq(doctors.slug, slug)) }));
  if (requested) {
    if (await taken(requested)) throw new ApiError(409, "slug_taken");
    return requested;
  }
  return uniqueSlug(slugify(nameEn), taken);
}
