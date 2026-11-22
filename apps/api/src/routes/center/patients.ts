import { and, desc, eq, like, or, sql } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { mergePatientsSchema, newPatientSchema, patientsQuerySchema, patientUpdateSchema } from "@mc/shared";
import { appointments, bookingRequests, patients } from "../../db/schema";
import type { AppEnv } from "../../env";
import { audit } from "../../lib/audit";
import { ApiError } from "../../lib/errors";
import { validate } from "../../lib/validate";
import { centerOf, requireAuth } from "../../middleware/auth";
import { listAppointments } from "./appointments";

const reception = requireAuth("manager", "receptionist");

/** Visit counts per patient, for search results and profiles. */
// Column names are written out in full: inside a subquery the bare "id" would refer to appointments.id.
const stats = {
  total: sql<number>`(select count(*) from appointments a where a.patient_id = "patients"."id")`,
  completed: sql<number>`(select count(*) from appointments a where a.patient_id = "patients"."id" and a.status = 'completed')`,
  noShow: sql<number>`(select count(*) from appointments a where a.patient_id = "patients"."id" and a.status = 'no_show')`,
};

/** Patients (spec §11.6). Administrative data only — never medical information. */
export const patientRoutes = new Hono<AppEnv>()
  /** Search by name or by any part of the phone number (local "09…" works too). */
  .get("/", requireAuth(), validate("query", patientsQuerySchema), async (c) => {
    const { q } = c.req.valid("query");
    const digits = q.replace(/\D/g, "").replace(/^0+/, "");
    const filter = !q
      ? undefined
      : digits.length >= 3 && digits.length === q.replace(/[\s+()-]/g, "").replace(/^0+/, "").length
        ? like(patients.phone, `%${digits}%`)
        : or(sql`lower(${patients.fullName}) like ${`%${q.toLowerCase()}%`}`, digits.length >= 3 ? like(patients.phone, `%${digits}%`) : undefined);
    const rows = await c
      .get("db")
      .select({ patient: patients, ...stats })
      .from(patients)
      .where(and(eq(patients.centerId, centerOf(c)), filter))
      .orderBy(desc(patients.updatedAt))
      .limit(30);
    return c.json({ patients: rows.map((r) => ({ ...r.patient, total: r.total, completed: r.completed, noShow: r.noShow })) });
  })

  .get("/:id", requireAuth(), async (c) => {
    const db = c.get("db");
    const p = await findPatient(c);
    const [row] = await db.select(stats).from(patients).where(eq(patients.id, p.id));
    const [history, requests] = await Promise.all([
      listAppointments(db, eq(appointments.patientId, p.id), "recent", 100),
      db.query.bookingRequests.findMany({ where: eq(bookingRequests.patientId, p.id), orderBy: desc(bookingRequests.createdAt), limit: 20 }),
    ]);
    return c.json({ patient: { ...p, ...row }, appointments: history, requests });
  })

  .post("/", reception, validate("json", newPatientSchema), async (c) => {
    const db = c.get("db");
    const input = c.req.valid("json");
    const existing = await db.query.patients.findFirst({
      where: and(eq(patients.centerId, centerOf(c)), eq(patients.phone, input.phone), sql`lower(${patients.fullName}) = lower(${input.fullName})`),
    });
    if (existing) return c.json({ error: { code: "patient_exists" }, patient: existing }, 409);
    const [patient] = await db
      .insert(patients)
      .values({ ...input, centerId: centerOf(c), source: "phone" })
      .returning();
    await audit(c, { entity: "patient", entityId: patient!.id, action: "create" });
    return c.json({ patient }, 201);
  })

  .patch("/:id", reception, validate("json", patientUpdateSchema), async (c) => {
    const p = await findPatient(c);
    const input = c.req.valid("json");
    const [patient] = await c.get("db").update(patients).set(input).where(eq(patients.id, p.id)).returning();
    await audit(c, { entity: "patient", entityId: p.id, action: "update", changes: Object.keys(input).reduce((o, k) => ({ ...o, [k]: true }), {}) });
    return c.json({ patient });
  })

  /** Merge a duplicate record into another one: history moves, the duplicate is removed (manager only). */
  .post("/:id/merge", requireAuth("manager"), validate("json", mergePatientsSchema), async (c) => {
    const db = c.get("db");
    const from = await findPatient(c);
    const { intoId } = c.req.valid("json");
    if (intoId === from.id) throw new ApiError(400, "same_patient");
    const into = await db.query.patients.findFirst({ where: and(eq(patients.id, intoId), eq(patients.centerId, from.centerId)) });
    if (!into) throw new ApiError(404, "not_found");
    await db.batch([
      db.update(appointments).set({ patientId: into.id }).where(eq(appointments.patientId, from.id)),
      db.update(bookingRequests).set({ patientId: into.id }).where(eq(bookingRequests.patientId, from.id)),
      db.delete(patients).where(eq(patients.id, from.id)),
    ]);
    await audit(c, { entity: "patient", entityId: into.id, action: "merge", changes: { mergedFrom: from.id } });
    return c.json({ ok: true, patientId: into.id });
  });

async function findPatient(c: Context<AppEnv>) {
  const p = await c.get("db").query.patients.findFirst({
    where: and(eq(patients.id, c.req.param("id")!), eq(patients.centerId, centerOf(c))),
  });
  if (!p) throw new ApiError(404, "not_found");
  return p;
}
