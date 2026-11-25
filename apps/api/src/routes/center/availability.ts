import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { Hono, type Context } from "hono";
import {
  addDays,
  availabilityCreateSchema,
  availabilityQuerySchema,
  availabilityUpdateSchema,
  copyWeekSchema,
  daysBetween,
  slotsQuerySchema,
  todayIn,
  weekStart,
  zonedToUtc,
} from "@mc/shared";
import { availabilitySessions, centers, doctors } from "../../db/schema";
import { availableSlots, blockingAppointments, overlappingSessions, sessionWindow } from "../../domain/availability";
import type { AppEnv } from "../../env";
import { audit } from "../../lib/audit";
import { ApiError } from "../../lib/errors";
import { validate } from "../../lib/validate";
import { centerOf, requireAuth } from "../../middleware/auth";

/** Who may plan availability: reception and managers (spec §4). */
const planner = requireAuth("manager", "receptionist");

/**
 * Availability sessions (spec §8, §11.7): per-date blocks of time when a doctor sees patients.
 */
export const availabilityRoutes = new Hono<AppEnv>()
  .get("/", requireAuth(), validate("query", availabilityQuerySchema), async (c) => {
    const db = c.get("db");
    const center = await loadCenter(c);
    const { doctorId, from, to } = c.req.valid("query");
    const rows = await db
      .select({ session: availabilitySessions })
      .from(availabilitySessions)
      .innerJoin(doctors, eq(doctors.id, availabilitySessions.doctorId))
      .where(
        and(
          eq(availabilitySessions.centerId, center.id),
          gte(availabilitySessions.date, from),
          lte(availabilitySessions.date, to),
          doctorId ? eq(availabilitySessions.doctorId, doctorId) : undefined,
        ),
      )
      .orderBy(asc(availabilitySessions.date), asc(availabilitySessions.startTime));
    const sessions = rows.map((r) => r.session);

    // Booked appointments per session, so planners see what a change would affect.
    const busy = await blockingAppointments(
      db,
      [...new Set(sessions.map((s) => s.doctorId))],
      zonedToUtc(from, "00:00", center.timezone),
      zonedToUtc(addDays(to, 1), "00:00", center.timezone),
    );
    return c.json({
      sessions: sessions.map((s) => {
        const w = sessionWindow(s, center.timezone);
        const booked = busy.filter((b) => b.doctorId === s.doctorId && b.startAt.getTime() < w.endAt && b.endAt.getTime() > w.startAt);
        return { ...s, bookedCount: booked.length };
      }),
    });
  })

  .post("/", planner, validate("json", availabilityCreateSchema), async (c) => {
    const db = c.get("db");
    const center = await loadCenter(c);
    const input = c.req.valid("json");
    await assertDoctor(c, input.doctorId);
    if (input.date < todayIn(center.timezone)) throw new ApiError(400, "date_in_past");
    if ((await overlappingSessions(db, input.doctorId, input.date, input.startTime, input.endTime)).length) {
      throw new ApiError(409, "session_overlaps");
    }
    const [session] = await db
      .insert(availabilitySessions)
      .values({ ...input, centerId: center.id, createdBy: c.get("user")!.id })
      .returning();
    await audit(c, { entity: "availability", entityId: session!.id, action: "create", changes: input });
    return c.json({ session: { ...session!, bookedCount: 0 } }, 201);
  })

  .patch("/:id", planner, validate("json", availabilityUpdateSchema), async (c) => {
    const db = c.get("db");
    const center = await loadCenter(c);
    const existing = await findSession(c);
    const { confirm, ...changes } = c.req.valid("json");
    const next = { ...existing, ...stripUndefined(changes) };
    if (next.endTime <= next.startTime) throw new ApiError(400, "end_before_start");
    if (
      (changes.startTime || changes.endTime) &&
      (await overlappingSessions(db, existing.doctorId, existing.date, next.startTime, next.endTime, existing.id)).length
    ) {
      throw new ApiError(409, "session_overlaps");
    }

    // Booked appointments that would no longer be inside an open session.
    const oldW = sessionWindow(existing, center.timezone);
    const newW = sessionWindow(next, center.timezone);
    const booked = await blockingAppointments(db, [existing.doctorId], oldW.startAt, oldW.endAt);
    const affected = booked.filter(
      (b) => next.status === "closed" || b.startAt.getTime() < newW.startAt || b.endAt.getTime() > newW.endAt,
    );
    if (affected.length && !confirm) return c.json({ error: { code: "session_has_appointments" }, affected }, 409);

    const [session] = await db
      .update(availabilitySessions)
      .set(stripUndefined(changes))
      .where(eq(availabilitySessions.id, existing.id))
      .returning();
    await audit(c, {
      entity: "availability",
      entityId: existing.id,
      action: changes.status === "closed" ? "close" : changes.status === "open" ? "reopen" : "update",
      changes: { ...changes, affectedAppointments: affected.map((a) => a.id) },
    });
    return c.json({ session: { ...session!, bookedCount: booked.length }, affected });
  })

  .delete("/:id", planner, async (c) => {
    const db = c.get("db");
    const center = await loadCenter(c);
    const existing = await findSession(c);
    const w = sessionWindow(existing, center.timezone);
    const affected = await blockingAppointments(db, [existing.doctorId], w.startAt, w.endAt);
    if (affected.length && c.req.query("confirm") !== "1") {
      return c.json({ error: { code: "session_has_appointments" }, affected }, 409);
    }
    await db.delete(availabilitySessions).where(eq(availabilitySessions.id, existing.id));
    await audit(c, {
      entity: "availability",
      entityId: existing.id,
      action: "delete",
      changes: { date: existing.date, startTime: existing.startTime, endTime: existing.endTime, affectedAppointments: affected.map((a) => a.id) },
    });
    return c.json({ ok: true, affected });
  })

  /**
   * Copy one week's sessions to another week (spec §8.8). With dryRun (the default) nothing is saved:
   * the planner reviews the list first, then calls again with dryRun=false.
   * Sessions that would overlap existing ones, or fall in the past, are skipped.
   */
  .post("/copy-week", planner, validate("json", copyWeekSchema), async (c) => {
    const db = c.get("db");
    const center = await loadCenter(c);
    const input = c.req.valid("json");
    const fromWeek = weekStart(input.fromWeek);
    const toWeek = weekStart(input.toWeek);
    const shift = daysBetween(fromWeek, toWeek);
    if (shift === 0) throw new ApiError(400, "same_week");
    if (input.doctorId) await assertDoctor(c, input.doctorId);

    const scope = and(
      eq(availabilitySessions.centerId, center.id),
      input.doctorId ? eq(availabilitySessions.doctorId, input.doctorId) : undefined,
    );
    const source = await db.query.availabilitySessions.findMany({
      where: and(scope, eq(availabilitySessions.status, "open"), gte(availabilitySessions.date, fromWeek), lte(availabilitySessions.date, addDays(fromWeek, 6))),
      orderBy: [asc(availabilitySessions.date), asc(availabilitySessions.startTime)],
    });
    const existing = await db.query.availabilitySessions.findMany({
      where: and(scope, gte(availabilitySessions.date, toWeek), lte(availabilitySessions.date, addDays(toWeek, 6))),
    });
    // Only active doctors are copied.
    const activeDoctorIds = new Set(
      (
        await db
          .select({ id: doctors.id })
          .from(doctors)
          .where(and(eq(doctors.centerId, center.id), eq(doctors.isActive, true), inArray(doctors.id, [...new Set(source.map((s) => s.doctorId)), ""])))
      ).map((d) => d.id),
    );

    const today = todayIn(center.timezone);
    const planned: { doctorId: string; date: string; startTime: string; endTime: string; note: string | null }[] = [];
    const skipped: { doctorId: string; date: string; startTime: string; endTime: string; reason: string }[] = [];
    for (const s of source) {
      const target = { doctorId: s.doctorId, date: addDays(s.date, shift), startTime: s.startTime, endTime: s.endTime, note: s.note };
      const clash = [...existing, ...planned].some(
        (e) => e.doctorId === target.doctorId && e.date === target.date && e.startTime < target.endTime && target.startTime < e.endTime,
      );
      if (!activeDoctorIds.has(s.doctorId)) skipped.push({ ...target, reason: "doctor_inactive" });
      else if (target.date < today) skipped.push({ ...target, reason: "date_in_past" });
      else if (clash) skipped.push({ ...target, reason: "session_overlaps" });
      else planned.push(target);
    }

    if (!input.dryRun && planned.length) {
      const userId = c.get("user")!.id;
      await db.batch(
        planned.map((p) => db.insert(availabilitySessions).values({ ...p, centerId: center.id, createdBy: userId })) as [never, ...never[]],
      );
      await audit(c, {
        entity: "availability",
        action: "copy_week",
        changes: { fromWeek, toWeek, doctorId: input.doctorId ?? null, created: planned.length, skipped: skipped.length },
      });
    }
    return c.json({ fromWeek, toWeek, dryRun: input.dryRun, planned, skipped });
  })

  /** Free slots for reception (no minimum notice, no booking-window limit). */
  .get("/slots/:doctorId", requireAuth(), validate("query", slotsQuerySchema), async (c) => {
    const center = await loadCenter(c);
    const doctorId = c.req.param("doctorId");
    await assertDoctor(c, doctorId);
    const { bookingType, from, days } = c.req.valid("query");
    const result = await availableSlots(c.get("db"), center, doctorId, bookingType, from, addDays(from, days - 1), {
      minLeadMinutes: 0,
      maxAdvanceDays: null,
      now: Date.now(),
    });
    if (!result) throw new ApiError(404, "booking_type_not_offered");
    return c.json(result);
  });

async function loadCenter(c: Context<AppEnv>) {
  const center = await c.get("db").query.centers.findFirst({ where: eq(centers.id, centerOf(c)) });
  if (!center) throw new ApiError(404, "not_found");
  return center;
}

async function assertDoctor(c: Context<AppEnv>, doctorId: string) {
  const doctor = await c.get("db").query.doctors.findFirst({ where: and(eq(doctors.id, doctorId), eq(doctors.centerId, centerOf(c))) });
  if (!doctor) throw new ApiError(404, "doctor_not_found");
  return doctor;
}

async function findSession(c: Context<AppEnv>) {
  const s = await c.get("db").query.availabilitySessions.findFirst({
    where: and(eq(availabilitySessions.id, c.req.param("id")!), eq(availabilitySessions.centerId, centerOf(c))),
  });
  if (!s) throw new ApiError(404, "not_found");
  return s;
}

function stripUndefined<T extends Record<string, unknown>>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}
