import { and, asc, count, desc, eq, gte, inArray, lt, type SQL } from "drizzle-orm";
import { Hono, type Context } from "hono";
import {
  addDays,
  appointmentsQuerySchema,
  appointmentUpdateSchema,
  fitsInSession,
  nextStatus,
  rescheduleSchema,
  sendMessageSchema,
  staffAppointmentSchema,
  statusActionSchema,
  todayIn,
  zonedParts,
  zonedToUtc,
  type BookingType,
} from "@mc/shared";
import type { Database } from "../../db/client";
import {
  appointments,
  auditLog,
  availabilitySessions,
  bookingRequests,
  centers,
  doctors,
  doctorServices,
  messageLog,
  patients,
  users,
} from "../../db/schema";
import { insertAppointmentIfFree, updateAppointmentIfFree } from "../../domain/booking";
import { renderMessage } from "../../domain/messages";
import { findOrCreatePatient, hasCompletedVisit } from "../../domain/patients";
import type { AppEnv } from "../../env";
import { audit } from "../../lib/audit";
import { ApiError } from "../../lib/errors";
import { validate } from "../../lib/validate";
import { centerOf, requireAuth } from "../../middleware/auth";

const reception = requireAuth("manager", "receptionist");
type CenterRow = typeof centers.$inferSelect;

/** Appointments for reception (spec §11.1–11.4). */
export const appointmentRoutes = new Hono<AppEnv>()
  /** Today screen in one request (fewer round trips on slow connections). */
  .get("/today", requireAuth(), async (c) => {
    const db = c.get("db");
    const center = await loadCenter(c);
    const today = todayIn(center.timezone);
    const dayStart = zonedToUtc(today, "00:00", center.timezone);
    const tomorrowStart = zonedToUtc(addDays(today, 1), "00:00", center.timezone);
    const dayAfter = zonedToUtc(addDays(today, 2), "00:00", center.timezone);

    const [pending, agenda, tomorrow, [newRequests]] = await Promise.all([
      listAppointments(db, and(eq(appointments.centerId, center.id), eq(appointments.status, "pending"), gte(appointments.endAt, new Date(dayStart))), "created"),
      listAppointments(db, and(eq(appointments.centerId, center.id), gte(appointments.startAt, new Date(dayStart)), lt(appointments.startAt, new Date(tomorrowStart)))),
      listAppointments(
        db,
        and(
          eq(appointments.centerId, center.id),
          inArray(appointments.status, ["pending", "confirmed"]),
          gte(appointments.startAt, new Date(tomorrowStart)),
          lt(appointments.startAt, new Date(dayAfter)),
        ),
      ),
      db.select({ n: count() }).from(bookingRequests).where(and(eq(bookingRequests.centerId, center.id), eq(bookingRequests.status, "new"))),
    ]);
    const reminded = new Set(
      tomorrow.length
        ? (
            await db
              .select({ id: messageLog.appointmentId })
              .from(messageLog)
              .where(and(inArray(messageLog.appointmentId, tomorrow.map((a) => a.id)), eq(messageLog.templateKey, "reminder")))
          ).map((r) => r.id)
        : [],
    );
    return c.json({
      date: today,
      pending,
      agenda,
      tomorrow: tomorrow.map((a) => ({ ...a, reminderSent: reminded.has(a.id) })),
      newRequests: newRequests!.n,
    });
  })

  .get("/", requireAuth(), validate("query", appointmentsQuerySchema), async (c) => {
    const center = await loadCenter(c);
    const { from, to, doctorId, status } = c.req.valid("query");
    const rows = await listAppointments(
      c.get("db"),
      and(
        eq(appointments.centerId, center.id),
        gte(appointments.startAt, new Date(zonedToUtc(from, "00:00", center.timezone))),
        lt(appointments.startAt, new Date(zonedToUtc(addDays(to, 1), "00:00", center.timezone))),
        doctorId ? eq(appointments.doctorId, doctorId) : undefined,
        status ? eq(appointments.status, status) : undefined,
      ),
    );
    return c.json({ appointments: rows });
  })

  .get("/:id", requireAuth(), async (c) => {
    const db = c.get("db");
    const a = await findAppointment(c);
    const [full] = await listAppointments(db, eq(appointments.id, a.id));
    const [messages, history, patientHistory] = await Promise.all([
      db
        .select({ id: messageLog.id, templateKey: messageLog.templateKey, sentAt: messageLog.sentAt, sentBy: users.name })
        .from(messageLog)
        .leftJoin(users, eq(users.id, messageLog.sentBy))
        .where(eq(messageLog.appointmentId, a.id))
        .orderBy(desc(messageLog.sentAt)),
      db
        .select({ id: auditLog.id, action: auditLog.action, at: auditLog.at, changes: auditLog.changes, userName: users.name, isSupportAction: auditLog.isSupportAction })
        .from(auditLog)
        .leftJoin(users, eq(users.id, auditLog.userId))
        .where(and(eq(auditLog.entity, "appointment"), eq(auditLog.entityId, a.id)))
        .orderBy(desc(auditLog.at)),
      listAppointments(db, eq(appointments.patientId, a.patientId), "recent", 10),
    ]);
    return c.json({
      appointment: { ...full!, cancelReason: a.cancelReason, confirmedAt: a.confirmedAt, checkedInAt: a.checkedInAt, completedAt: a.completedAt },
      messages,
      history,
      patientHistory: patientHistory.filter((p) => p.id !== a.id),
    });
  })

  /** Reception books by phone, WhatsApp or walk-in (spec §11.4). */
  .post("/", reception, validate("json", staffAppointmentSchema), async (c) => {
    const db = c.get("db");
    const center = await loadCenter(c);
    const input = c.req.valid("json");
    const doctor = await db.query.doctors.findFirst({ where: and(eq(doctors.id, input.doctorId), eq(doctors.centerId, center.id)) });
    if (!doctor) throw new ApiError(404, "doctor_not_found");
    const service = await activeService(db, doctor.id, input.bookingType);
    const endAt = input.startAt + service.durationMinutes * 60_000;

    let patientId = input.patientId;
    if (patientId) {
      const p = await db.query.patients.findFirst({ where: and(eq(patients.id, patientId), eq(patients.centerId, center.id)) });
      if (!p) throw new ApiError(404, "patient_not_found");
    }
    let request: typeof bookingRequests.$inferSelect | undefined;
    if (input.requestId) {
      request = await db.query.bookingRequests.findFirst({ where: and(eq(bookingRequests.id, input.requestId), eq(bookingRequests.centerId, center.id)) });
      if (!request || request.status === "converted" || request.status === "declined") throw new ApiError(409, "request_not_open");
    }

    const session = await sessionFor(db, center, doctor.id, input.startAt, endAt);
    if (!session && !input.override) throw new ApiError(409, "outside_session");

    if (!patientId) {
      const created = await findOrCreatePatient(db, center.id, { ...input.newPatient!, source: input.source });
      if (input.newPatient!.gender || input.newPatient!.dateOfBirth || input.newPatient!.notes) {
        await db
          .update(patients)
          .set({ gender: input.newPatient!.gender, dateOfBirth: input.newPatient!.dateOfBirth, notes: input.newPatient!.notes })
          .where(eq(patients.id, created.id));
      }
      patientId = created.id;
    }
    const revisitFlag = input.bookingType === "revisit" && !(await hasCompletedVisit(db, patientId, doctor.id));

    const result = await insertAppointmentIfFree(db, {
      centerId: center.id,
      patientId,
      doctorId: doctor.id,
      bookingType: input.bookingType,
      sessionId: session?.id ?? null,
      startAt: input.startAt,
      endAt,
      status: input.status,
      source: input.source,
      priceSnapshot: service.price,
      revisitFlag,
      isOverride: input.override,
      internalNote: input.internalNote,
      createdBy: c.get("user")!.id,
    });
    if (!result.ok) throw new ApiError(409, "slot_taken");

    if (request) {
      await db
        .update(bookingRequests)
        .set({ status: "converted", appointmentId: result.id, handledBy: c.get("user")!.id })
        .where(eq(bookingRequests.id, request.id));
      await audit(c, { entity: "booking_request", entityId: request.id, action: "convert", changes: { appointmentId: result.id } });
    }
    await audit(c, {
      entity: "appointment",
      entityId: result.id,
      action: input.override ? "create_override" : "create",
      changes: { source: input.source, status: input.status, startAt: input.startAt, bookingType: input.bookingType },
    });
    const [created] = await listAppointments(db, eq(appointments.id, result.id));
    return c.json({ appointment: created }, 201);
  })

  .post("/:id/status", reception, validate("json", statusActionSchema), async (c) => {
    const db = c.get("db");
    const a = await findAppointment(c);
    const { action, reason } = c.req.valid("json");
    const to = nextStatus(a.status, action);
    if (!to) throw new ApiError(409, "invalid_transition");
    const now = new Date();

    if (action === "reopen") {
      // The time may have been given to someone else meanwhile.
      const ok = await updateAppointmentIfFree(db, {
        id: a.id,
        doctorId: a.doctorId,
        sessionId: a.sessionId,
        startAt: a.startAt.getTime(),
        endAt: a.endAt.getTime(),
        bookingType: a.bookingType,
        priceSnapshot: a.priceSnapshot,
        status: "confirmed",
        isOverride: a.isOverride || !a.sessionId,
      });
      if (!ok) throw new ApiError(409, "slot_taken");
      await db.update(appointments).set({ cancelReason: null, cancelledBy: null }).where(eq(appointments.id, a.id));
    } else {
      await db
        .update(appointments)
        .set({
          status: to,
          ...(action === "confirm" ? { confirmedAt: now } : {}),
          ...(action === "check_in" ? { checkedInAt: now, confirmedAt: a.confirmedAt ?? now } : {}),
          ...(action === "complete" ? { completedAt: now } : {}),
          ...(action === "cancel" ? { cancelReason: reason, cancelledBy: c.get("user")!.id } : {}),
        })
        .where(and(eq(appointments.id, a.id), eq(appointments.status, a.status)));
    }
    await audit(c, { entity: "appointment", entityId: a.id, action, changes: { from: a.status, to, ...(reason ? { reason } : {}) } });
    const [updated] = await listAppointments(db, eq(appointments.id, a.id));
    return c.json({ appointment: updated });
  })

  /** Move to another time and/or change the booking type (spec §7 "reschedule"). */
  .post("/:id/reschedule", reception, validate("json", rescheduleSchema), async (c) => {
    const db = c.get("db");
    const center = await loadCenter(c);
    const a = await findAppointment(c);
    if (!["pending", "confirmed", "checked_in"].includes(a.status)) throw new ApiError(409, "invalid_transition");
    const input = c.req.valid("json");
    const bookingType = input.bookingType ?? a.bookingType;
    const service = await activeService(db, a.doctorId, bookingType);
    const endAt = input.startAt + service.durationMinutes * 60_000;
    const session = await sessionFor(db, center, a.doctorId, input.startAt, endAt);
    if (!session && !input.override) throw new ApiError(409, "outside_session");
    // Price changes only when the type changes; otherwise the patient keeps the price they were given.
    const priceSnapshot = bookingType === a.bookingType ? a.priceSnapshot : service.price;
    const ok = await updateAppointmentIfFree(db, {
      id: a.id,
      doctorId: a.doctorId,
      sessionId: session?.id ?? null,
      startAt: input.startAt,
      endAt,
      bookingType,
      priceSnapshot,
      status: a.status,
      isOverride: input.override,
    });
    if (!ok) throw new ApiError(409, "slot_taken");
    if (bookingType !== a.bookingType) {
      const revisitFlag = bookingType === "revisit" && !(await hasCompletedVisit(db, a.patientId, a.doctorId));
      await db.update(appointments).set({ revisitFlag }).where(eq(appointments.id, a.id));
    }
    await audit(c, {
      entity: "appointment",
      entityId: a.id,
      action: "reschedule",
      changes: { from: { startAt: a.startAt.getTime(), bookingType: a.bookingType }, to: { startAt: input.startAt, bookingType }, override: input.override },
    });
    const [updated] = await listAppointments(db, eq(appointments.id, a.id));
    return c.json({ appointment: updated });
  })

  .patch("/:id", reception, validate("json", appointmentUpdateSchema), async (c) => {
    const a = await findAppointment(c);
    const input = c.req.valid("json");
    await c.get("db").update(appointments).set(input).where(eq(appointments.id, a.id));
    await audit(c, { entity: "appointment", entityId: a.id, action: "update_note" });
    const [updated] = await listAppointments(c.get("db"), eq(appointments.id, a.id));
    return c.json({ appointment: updated });
  })

  /** Prepares a WhatsApp click-to-chat message and records that reception opened it (spec §13). */
  .post("/:id/messages", reception, validate("json", sendMessageSchema), async (c) => {
    const db = c.get("db");
    const center = await loadCenter(c);
    const a = await findAppointment(c);
    const { templateKey } = c.req.valid("json");
    const [patient, doctor] = await Promise.all([
      db.query.patients.findFirst({ where: eq(patients.id, a.patientId) }),
      db.query.doctors.findFirst({ where: eq(doctors.id, a.doctorId) }),
    ]);
    const message = await renderMessage(db, {
      center,
      doctor: doctor!,
      templateKey,
      patient: patient!,
      bookingType: a.bookingType,
      startAt: a.startAt,
      price: a.priceSnapshot,
      referenceCode: a.referenceCode,
    });
    await db.insert(messageLog).values({ centerId: center.id, appointmentId: a.id, templateKey, sentBy: c.get("user")!.id, sentAt: new Date() });
    return c.json(message);
  });

// ---------------------------------------------------------------- helpers

export async function loadCenter(c: Context<AppEnv>): Promise<CenterRow> {
  const center = await c.get("db").query.centers.findFirst({ where: eq(centers.id, centerOf(c)) });
  if (!center) throw new ApiError(404, "not_found");
  return center;
}

async function findAppointment(c: Context<AppEnv>) {
  const a = await c.get("db").query.appointments.findFirst({
    where: and(eq(appointments.id, c.req.param("id")!), eq(appointments.centerId, centerOf(c))),
  });
  if (!a) throw new ApiError(404, "not_found");
  return a;
}

async function activeService(db: Database, doctorId: string, bookingType: BookingType) {
  const service = await db.query.doctorServices.findFirst({
    where: and(eq(doctorServices.doctorId, doctorId), eq(doctorServices.bookingType, bookingType), eq(doctorServices.isActive, true)),
  });
  if (!service) throw new ApiError(404, "booking_type_not_offered");
  return service;
}

/** The open session that fully contains [startAt, endAt), if any. */
async function sessionFor(db: Database, center: CenterRow, doctorId: string, startAt: number, endAt: number) {
  const date = zonedParts(startAt, center.timezone).date;
  const sessions = await db.query.availabilitySessions.findMany({
    where: and(eq(availabilitySessions.doctorId, doctorId), eq(availabilitySessions.date, date), eq(availabilitySessions.status, "open")),
  });
  return sessions.find((s) => fitsInSession(s, startAt, endAt, center.timezone)) ?? null;
}

/** Appointments with the patient and doctor names reception needs. */
export async function listAppointments(db: Database, where: SQL | undefined, order: "start" | "created" | "recent" = "start", limit = 500) {
  const rows = await db
    .select({
      id: appointments.id,
      referenceCode: appointments.referenceCode,
      startAt: appointments.startAt,
      endAt: appointments.endAt,
      status: appointments.status,
      source: appointments.source,
      bookingType: appointments.bookingType,
      priceSnapshot: appointments.priceSnapshot,
      revisitFlag: appointments.revisitFlag,
      isOverride: appointments.isOverride,
      patientNote: appointments.patientNote,
      internalNote: appointments.internalNote,
      createdAt: appointments.createdAt,
      patientId: patients.id,
      patientName: patients.fullName,
      patientPhone: patients.phone,
      patientLocale: patients.preferredLocale,
      doctorId: doctors.id,
      doctorNameAr: doctors.nameAr,
      doctorNameEn: doctors.nameEn,
    })
    .from(appointments)
    .innerJoin(patients, eq(patients.id, appointments.patientId))
    .innerJoin(doctors, eq(doctors.id, appointments.doctorId))
    .where(where)
    .orderBy(order === "created" ? asc(appointments.createdAt) : order === "recent" ? desc(appointments.startAt) : asc(appointments.startAt))
    .limit(limit);
  return rows.map(({ patientId, patientName, patientPhone, patientLocale, doctorId, doctorNameAr, doctorNameEn, ...a }) => ({
    ...a,
    patient: { id: patientId, fullName: patientName, phone: patientPhone, preferredLocale: patientLocale },
    doctor: { id: doctorId, nameAr: doctorNameAr, nameEn: doctorNameEn },
  }));
}
