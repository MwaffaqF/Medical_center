import { and, desc, eq, inArray } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { z } from "zod";
import { REQUEST_STATUSES, requestUpdateSchema } from "@mc/shared";
import { bookingRequests, doctors, messageLog, patients } from "../../db/schema";
import { renderMessage } from "../../domain/messages";
import type { AppEnv } from "../../env";
import { audit } from "../../lib/audit";
import { ApiError } from "../../lib/errors";
import { validate } from "../../lib/validate";
import { centerOf, requireAuth } from "../../middleware/auth";
import { loadCenter } from "./appointments";

const reception = requireAuth("manager", "receptionist");

/**
 * Booking requests inbox (spec §11.5). Converting a request into an appointment goes through
 * POST /center/appointments with `requestId`, so it uses the same booking checks.
 */
export const requestRoutes = new Hono<AppEnv>()
  .get("/", requireAuth(), validate("query", z.object({ status: z.enum(REQUEST_STATUSES).optional() })), async (c) => {
    const db = c.get("db");
    const { status } = c.req.valid("query");
    const rows = await db
      .select({
        request: bookingRequests,
        patient: { id: patients.id, fullName: patients.fullName, phone: patients.phone, preferredLocale: patients.preferredLocale },
        doctor: { id: doctors.id, nameAr: doctors.nameAr, nameEn: doctors.nameEn },
      })
      .from(bookingRequests)
      .innerJoin(patients, eq(patients.id, bookingRequests.patientId))
      .innerJoin(doctors, eq(doctors.id, bookingRequests.doctorId))
      .where(and(eq(bookingRequests.centerId, centerOf(c)), status ? eq(bookingRequests.status, status) : undefined))
      .orderBy(status === "new" || !status ? bookingRequests.createdAt : desc(bookingRequests.updatedAt))
      .limit(200);
    const ids = rows.map((r) => r.request.id);
    const sent = ids.length
      ? await db.select({ id: messageLog.requestId, at: messageLog.sentAt }).from(messageLog).where(inArray(messageLog.requestId, ids))
      : [];
    return c.json({
      requests: rows.map((r) => ({
        ...r.request,
        patient: r.patient,
        doctor: r.doctor,
        lastMessageAt: sent.filter((s) => s.id === r.request.id).sort((a, b) => +b.at - +a.at)[0]?.at ?? null,
      })),
    });
  })

  .patch("/:id", reception, validate("json", requestUpdateSchema), async (c) => {
    const r = await findRequest(c);
    if (r.status === "converted") throw new ApiError(409, "request_not_open");
    const { status } = c.req.valid("json");
    const [updated] = await c
      .get("db")
      .update(bookingRequests)
      .set({ status, handledBy: c.get("user")!.id })
      .where(eq(bookingRequests.id, r.id))
      .returning();
    await audit(c, { entity: "booking_request", entityId: r.id, action: status === "declined" ? "decline" : status === "contacted" ? "mark_contacted" : "reopen" });
    return c.json({ request: updated });
  })

  .post("/:id/messages", reception, async (c) => {
    const db = c.get("db");
    const center = await loadCenter(c);
    const r = await findRequest(c);
    const [patient, doctor] = await Promise.all([
      db.query.patients.findFirst({ where: eq(patients.id, r.patientId) }),
      db.query.doctors.findFirst({ where: eq(doctors.id, r.doctorId) }),
    ]);
    const message = await renderMessage(db, {
      center,
      doctor: doctor!,
      templateKey: "request_followup",
      patient: patient!,
      bookingType: r.bookingType,
      referenceCode: r.referenceCode,
    });
    await db.insert(messageLog).values({ centerId: center.id, requestId: r.id, templateKey: "request_followup", sentBy: c.get("user")!.id, sentAt: new Date() });
    // Writing to the patient counts as contacting them.
    if (r.status === "new") await db.update(bookingRequests).set({ status: "contacted", handledBy: c.get("user")!.id }).where(eq(bookingRequests.id, r.id));
    return c.json(message);
  });

async function findRequest(c: Context<AppEnv>) {
  const r = await c.get("db").query.bookingRequests.findFirst({
    where: and(eq(bookingRequests.id, c.req.param("id")!), eq(bookingRequests.centerId, centerOf(c))),
  });
  if (!r) throw new ApiError(404, "not_found");
  return r;
}
