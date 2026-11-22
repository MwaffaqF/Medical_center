import { and, eq, gte, inArray, lt, lte } from "drizzle-orm";
import { addDays, BLOCKING_STATUSES, computeSlots, zonedToUtc, type BookingType, type SlotRules } from "@mc/shared";
import type { Database } from "../db/client";
import { appointments, availabilitySessions, centers, doctorServices, patients } from "../db/schema";

type SessionRow = typeof availabilitySessions.$inferSelect;
type CenterRow = typeof centers.$inferSelect;

/** UTC window covered by a session. */
export function sessionWindow(s: Pick<SessionRow, "date" | "startTime" | "endTime">, timeZone: string) {
  return { startAt: zonedToUtc(s.date, s.startTime, timeZone), endAt: zonedToUtc(s.date, s.endTime, timeZone) };
}

/** Booked (blocking) appointments of the given doctors that overlap [from, to). */
export async function blockingAppointments(db: Database, doctorIds: string[], from: number, to: number) {
  if (!doctorIds.length) return [];
  return db
    .select({
      id: appointments.id,
      doctorId: appointments.doctorId,
      startAt: appointments.startAt,
      endAt: appointments.endAt,
      status: appointments.status,
      referenceCode: appointments.referenceCode,
      patientName: patients.fullName,
      patientPhone: patients.phone,
    })
    .from(appointments)
    .innerJoin(patients, eq(patients.id, appointments.patientId))
    .where(
      and(
        inArray(appointments.doctorId, doctorIds),
        inArray(appointments.status, [...BLOCKING_STATUSES]),
        lt(appointments.startAt, new Date(to)),
        gte(appointments.endAt, new Date(from + 1)),
      ),
    )
    .orderBy(appointments.startAt);
}

/** Sessions of a doctor on a date that overlap the given times (optionally ignoring one session). */
export async function overlappingSessions(
  db: Database,
  doctorId: string,
  date: string,
  startTime: string,
  endTime: string,
  exceptId?: string,
) {
  const rows = await db.query.availabilitySessions.findMany({
    where: and(eq(availabilitySessions.doctorId, doctorId), eq(availabilitySessions.date, date)),
  });
  // "HH:MM" strings compare correctly as text.
  return rows.filter((r) => r.id !== exceptId && r.startTime < endTime && startTime < r.endTime);
}

/**
 * Free slots for one doctor and booking type, between two dates (inclusive), grouped by date.
 * Shared by the reception dashboard and (in M3) the public website.
 */
export async function availableSlots(
  db: Database,
  center: CenterRow,
  doctorId: string,
  bookingType: BookingType,
  fromDate: string,
  toDate: string,
  rules: Pick<SlotRules, "minLeadMinutes" | "maxAdvanceDays" | "now">,
) {
  const service = await db.query.doctorServices.findFirst({
    where: and(eq(doctorServices.doctorId, doctorId), eq(doctorServices.bookingType, bookingType), eq(doctorServices.isActive, true)),
  });
  if (!service) return null;

  const sessions = await db.query.availabilitySessions.findMany({
    where: and(
      eq(availabilitySessions.doctorId, doctorId),
      eq(availabilitySessions.status, "open"),
      gte(availabilitySessions.date, fromDate),
      lte(availabilitySessions.date, toDate),
    ),
  });
  const rangeStart = zonedToUtc(fromDate, "00:00", center.timezone);
  const rangeEnd = zonedToUtc(addDays(toDate, 1), "00:00", center.timezone);
  const busy = await blockingAppointments(db, [doctorId], rangeStart, rangeEnd);

  const slots = computeSlots(
    sessions,
    busy.map((b) => ({ startAt: b.startAt.getTime(), endAt: b.endAt.getTime() })),
    { ...rules, timeZone: center.timezone, durationMinutes: service.durationMinutes, stepMinutes: center.slotStepMinutes },
  );

  const days = new Map<string, typeof slots>();
  for (let d = fromDate; d <= toDate; d = addDays(d, 1)) days.set(d, []);
  for (const s of slots) days.get(s.date)?.push(s);
  return {
    bookingType,
    durationMinutes: service.durationMinutes,
    price: service.price,
    days: [...days.entries()].map(([date, list]) => ({ date, slots: list })),
  };
}
