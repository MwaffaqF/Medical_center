import { and, asc, eq, inArray } from "drizzle-orm";
import { Hono, type Context } from "hono";
import {
  addDays,
  BOOKING_TYPES,
  daysBetween,
  publicBookingSchema,
  publicRequestSchema,
  slotsQuerySchema,
  todayIn,
  zonedParts,
} from "@mc/shared";
import type { Database } from "../db/client";
import { bookingRequests, centers, doctors, doctorServices, doctorSpecialties, specialties } from "../db/schema";
import { availableSlots } from "../domain/availability";
import { insertAppointmentIfFree } from "../domain/booking";
import { findOrCreatePatient, hasCompletedVisit } from "../domain/patients";
import type { AppEnv } from "../env";
import { audit } from "../lib/audit";
import { ApiError } from "../lib/errors";
import * as rateLimit from "../lib/rate-limit";
import { referenceCode } from "../lib/tokens";
import { verifyTurnstile } from "../lib/turnstile";
import { validate } from "../lib/validate";

type CenterRow = typeof centers.$inferSelect;
type DoctorRow = typeof doctors.$inferSelect;

const HOUR = 3_600_000;
const MAX_PER_IP_PER_HOUR = 10;
/** Families often book several members from one phone. */
const MAX_PER_PHONE_PER_DAY = 5;
/** Public pages can be cached briefly at the edge; bookings always re-check availability. */
const PUBLIC_CACHE = "public, max-age=60, s-maxage=60";

/**
 * Public website API (spec §9, §10). No login. Only public fields are returned:
 * nothing about patients, staff or internal notes.
 */
export const publicRoutes = new Hono<AppEnv>()
  .get("/:slug/site", async (c) => {
    const db = c.get("db");
    const center = await loadCenter(c);
    if (center.status !== "active") {
      return c.json({ center: { ...publicCenter(center), status: center.status }, specialties: [], doctors: [] });
    }
    const docs = await db.query.doctors.findMany({
      where: and(eq(doctors.centerId, center.id), eq(doctors.isActive, true)),
      orderBy: [asc(doctors.sortOrder), asc(doctors.nameEn)],
    });
    const full = await withPublicRelations(db, docs);
    const specs = await db.query.specialties.findMany({
      where: and(eq(specialties.centerId, center.id), eq(specialties.isActive, true)),
      orderBy: [asc(specialties.sortOrder), asc(specialties.nameEn)],
    });
    c.header("Cache-Control", PUBLIC_CACHE);
    return c.json({
      center: { ...publicCenter(center), status: center.status },
      // Only specialties that have at least one active doctor are shown publicly.
      specialties: specs
        .filter((s) => full.some((d) => d.specialtyIds.includes(s.id)))
        .map((s) => ({
        id: s.id,
        slug: s.slug,
        nameAr: s.nameAr,
        nameEn: s.nameEn,
        descriptionAr: s.descriptionAr,
        descriptionEn: s.descriptionEn,
        icon: s.icon,
        doctorCount: full.filter((d) => d.specialtyIds.includes(s.id)).length,
      })),
      doctors: full,
    });
  })

  .get("/:slug/doctors/:doctorSlug", async (c) => {
    const center = await activeCenter(c);
    const doctor = await c.get("db").query.doctors.findFirst({
      where: and(eq(doctors.centerId, center.id), eq(doctors.slug, c.req.param("doctorSlug")), eq(doctors.isActive, true)),
    });
    if (!doctor) throw new ApiError(404, "not_found");
    const [full] = await withPublicRelations(c.get("db"), [doctor]);
    c.header("Cache-Control", PUBLIC_CACHE);
    return c.json({ doctor: full });
  })

  /** Free slots with the public rules: minimum notice and booking window (spec §8.4). */
  .get("/:slug/doctors/:doctorId/slots", validate("query", slotsQuerySchema), async (c) => {
    const center = await activeCenter(c);
    const doctor = await activeDoctor(c.get("db"), center.id, c.req.param("doctorId"));
    const { bookingType, from, days } = c.req.valid("query");
    const today = todayIn(center.timezone);
    const start = from < today ? today : from;
    const lastAllowed = addDays(today, center.maxAdvanceDays);
    const end = addDays(start, days - 1) > lastAllowed ? lastAllowed : addDays(start, days - 1);
    if (daysBetween(start, end) < 0) return c.json({ bookingType, durationMinutes: 0, price: 0, days: [] });
    const result = await availableSlots(c.get("db"), center, doctor.id, bookingType, start, end, {
      minLeadMinutes: center.minLeadMinutes,
      maxAdvanceDays: center.maxAdvanceDays,
      now: Date.now(),
    });
    if (!result) throw new ApiError(404, "booking_type_not_offered");
    c.header("Cache-Control", "no-store");
    return c.json({
      ...result,
      days: result.days.map((d) => ({ date: d.date, slots: d.slots.map((s) => ({ time: s.time, startAt: s.startAt })) })),
    });
  })

  /** Online booking: creates a pending appointment that reception confirms (spec §10). */
  .post("/:slug/bookings", validate("json", publicBookingSchema), async (c) => {
    const db = c.get("db");
    const center = await activeCenter(c);
    const input = c.req.valid("json");
    await verifyTurnstile(c, input.turnstileToken);
    await throttle(c, input.phone);

    const doctor = await activeDoctor(db, center.id, input.doctorId);
    const date = zonedParts(input.startAt, center.timezone).date;
    const slots = await availableSlots(db, center, doctor.id, input.bookingType, date, date, {
      minLeadMinutes: center.minLeadMinutes,
      maxAdvanceDays: center.maxAdvanceDays,
      now: Date.now(),
    });
    if (!slots) throw new ApiError(404, "booking_type_not_offered");
    const slot = slots.days.flatMap((d) => d.slots).find((s) => s.startAt === input.startAt);
    if (!slot) throw new ApiError(409, "slot_unavailable");

    const patient = await findOrCreatePatient(db, center.id, {
      fullName: input.fullName,
      phone: input.phone,
      preferredLocale: input.preferredLocale,
      source: "website",
    });
    const revisitFlag = input.bookingType === "revisit" && !(await hasCompletedVisit(db, patient.id, doctor.id));
    const result = await insertAppointmentIfFree(db, {
      centerId: center.id,
      patientId: patient.id,
      doctorId: doctor.id,
      bookingType: input.bookingType,
      sessionId: slot.sessionId,
      startAt: slot.startAt,
      endAt: slot.endAt,
      status: "pending",
      source: "website",
      priceSnapshot: slots.price,
      revisitFlag,
      patientNote: input.note,
    });
    if (!result.ok) throw new ApiError(409, "slot_taken");

    await audit(c, { entity: "appointment", entityId: result.id, action: "create_online", centerId: center.id, userId: null });
    return c.json(
      {
        booking: {
          referenceCode: result.referenceCode,
          status: "pending",
          bookingType: input.bookingType,
          startAt: slot.startAt,
          endAt: slot.endAt,
          price: slots.price,
          doctor: { nameAr: doctor.nameAr, nameEn: doctor.nameEn },
        },
      },
      201,
    );
  })

  /** Booking request for when no suitable time is open (spec §8.7). */
  .post("/:slug/requests", validate("json", publicRequestSchema), async (c) => {
    const db = c.get("db");
    const center = await activeCenter(c);
    const input = c.req.valid("json");
    await verifyTurnstile(c, input.turnstileToken);
    await throttle(c, input.phone);

    const doctor = await activeDoctor(db, center.id, input.doctorId);
    if (input.preferredDate && input.preferredDate < todayIn(center.timezone)) throw new ApiError(400, "date_in_past");
    const patient = await findOrCreatePatient(db, center.id, {
      fullName: input.fullName,
      phone: input.phone,
      preferredLocale: input.preferredLocale,
      source: "website",
    });
    let created: typeof bookingRequests.$inferSelect | undefined;
    for (let attempt = 0; attempt < 3 && !created; attempt++) {
      try {
        [created] = await db
          .insert(bookingRequests)
          .values({
            centerId: center.id,
            referenceCode: referenceCode(),
            patientId: patient.id,
            doctorId: doctor.id,
            bookingType: input.bookingType,
            preferredDate: input.preferredDate,
            preferredPeriod: input.preferredPeriod,
            patientNote: input.note,
          })
          .returning();
      } catch (e) {
        if (!String(e).includes("reference_code") && !String(e).includes("booking_requests_center_ref_uq")) throw e;
      }
    }
    if (!created) throw new ApiError(500, "internal_error");
    await audit(c, { entity: "booking_request", entityId: created.id, action: "create_online", centerId: center.id, userId: null });
    return c.json(
      {
        request: {
          referenceCode: created.referenceCode,
          bookingType: created.bookingType,
          preferredDate: created.preferredDate,
          preferredPeriod: created.preferredPeriod,
          doctor: { nameAr: doctor.nameAr, nameEn: doctor.nameEn },
        },
      },
      201,
    );
  });

// ---------------------------------------------------------------- helpers

async function loadCenter(c: Context<AppEnv>): Promise<CenterRow> {
  const slug = c.req.param("slug") ?? "";
  if (!/^[a-z0-9-]{2,60}$/.test(slug)) throw new ApiError(404, "not_found");
  const center = await c.get("db").query.centers.findFirst({ where: eq(centers.slug, slug) });
  if (!center) throw new ApiError(404, "not_found");
  return center;
}

async function activeCenter(c: Context<AppEnv>): Promise<CenterRow> {
  const center = await loadCenter(c);
  if (center.status !== "active") throw new ApiError(403, "center_suspended");
  return center;
}

async function activeDoctor(db: Database, centerId: string, doctorId: string): Promise<DoctorRow> {
  const doctor = await db.query.doctors.findFirst({
    where: and(eq(doctors.id, doctorId), eq(doctors.centerId, centerId), eq(doctors.isActive, true)),
  });
  if (!doctor) throw new ApiError(404, "doctor_not_found");
  return doctor;
}

/** Limits public submissions per network and per phone number (spec §10). */
async function throttle(c: Context<AppEnv>, phone: string) {
  const db = c.get("db");
  const ip = c.req.header("cf-connecting-ip") ?? "unknown";
  const perIp = await rateLimit.hit(db, `public:ip:${ip}`, HOUR);
  const perPhone = await rateLimit.hit(db, `public:phone:${phone}`, 24 * HOUR);
  if (perIp > MAX_PER_IP_PER_HOUR || perPhone > MAX_PER_PHONE_PER_DAY) throw new ApiError(429, "too_many_attempts");
}

function publicCenter(c: CenterRow) {
  return {
    slug: c.slug,
    nameAr: c.nameAr,
    nameEn: c.nameEn,
    logoUrl: c.logoUrl,
    phone: c.phone,
    whatsappPhone: c.whatsappPhone,
    addressAr: c.addressAr,
    addressEn: c.addressEn,
    mapUrl: c.mapUrl,
    openingHoursAr: c.openingHoursAr,
    openingHoursEn: c.openingHoursEn,
    aboutAr: c.aboutAr,
    aboutEn: c.aboutEn,
    timezone: c.timezone,
    currency: c.currency,
    defaultLocale: c.defaultLocale,
    maxAdvanceDays: c.maxAdvanceDays,
  };
}

async function withPublicRelations(db: Database, rows: DoctorRow[]) {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [links, services] = await Promise.all([
    db.select().from(doctorSpecialties).where(inArray(doctorSpecialties.doctorId, ids)),
    db
      .select()
      .from(doctorServices)
      .where(and(inArray(doctorServices.doctorId, ids), eq(doctorServices.isActive, true))),
  ]);
  return rows.map((d) => {
    const mine = links.filter((l) => l.doctorId === d.id);
    return {
      id: d.id,
      slug: d.slug,
      nameAr: d.nameAr,
      nameEn: d.nameEn,
      titleAr: d.titleAr,
      titleEn: d.titleEn,
      photoUrl: d.photoUrl,
      bioAr: d.bioAr,
      bioEn: d.bioEn,
      qualificationsAr: d.qualificationsAr,
      qualificationsEn: d.qualificationsEn,
      languages: d.languages,
      gender: d.gender,
      yearsExperience: d.yearsExperience,
      specialtyIds: mine.map((l) => l.specialtyId),
      primarySpecialtyId: mine.find((l) => l.isPrimary)?.specialtyId ?? mine[0]?.specialtyId ?? null,
      services: services
        .filter((s) => s.doctorId === d.id)
        .sort((a, b) => BOOKING_TYPES.indexOf(a.bookingType) - BOOKING_TYPES.indexOf(b.bookingType))
        .map((s) => ({ bookingType: s.bookingType, durationMinutes: s.durationMinutes, price: s.price, notesAr: s.notesAr, notesEn: s.notesEn })),
    };
  });
}

