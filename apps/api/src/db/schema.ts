import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import {
  APPOINTMENT_STATUSES,
  BOOKING_TYPES,
  CENTER_STATUSES,
  LOCALES,
  MESSAGE_TEMPLATE_KEYS,
  PREFERRED_PERIODS,
  REQUEST_STATUSES,
  ROLES,
  SOURCES,
} from "@mc/shared";

/**
 * Conventions
 * - ids: text (UUID v4).
 * - Instants (created_at, start_at, …): integer milliseconds since epoch, UTC.
 * - Calendar dates for availability: text "YYYY-MM-DD"; times: text "HH:MM" in the center's time zone.
 * - Money: integer, whole units of the center's currency (new Syrian pound for the pilot).
 * - Bilingual content: *_ar / *_en pairs.
 * - Every center-owned table has center_id, so the platform can host several centers.
 */

const id = () => text("id").primaryKey().$defaultFn(() => crypto.randomUUID());
const createdAt = () =>
  integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`);
const updatedAt = () =>
  integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`)
    .$onUpdate(() => new Date());
const centerId = () =>
  text("center_id")
    .notNull()
    .references(() => centers.id, { onDelete: "restrict" });

// ---------------------------------------------------------------- platform

export const centers = sqliteTable(
  "centers",
  {
    id: id(),
    slug: text("slug").notNull(),
    status: text("status", { enum: CENTER_STATUSES }).notNull().default("active"),
    nameAr: text("name_ar").notNull(),
    nameEn: text("name_en").notNull(),
    logoUrl: text("logo_url"),
    phone: text("phone"),
    whatsappPhone: text("whatsapp_phone"),
    addressAr: text("address_ar"),
    addressEn: text("address_en"),
    mapUrl: text("map_url"),
    openingHoursAr: text("opening_hours_ar"),
    openingHoursEn: text("opening_hours_en"),
    aboutAr: text("about_ar"),
    aboutEn: text("about_en"),
    timezone: text("timezone").notNull().default("Asia/Damascus"),
    defaultCountryCode: text("default_country_code").notNull().default("963"),
    currency: text("currency").notNull().default("SYP"),
    defaultLocale: text("default_locale", { enum: LOCALES }).notNull().default("ar"),
    slotStepMinutes: integer("slot_step_minutes").notNull().default(10),
    minLeadMinutes: integer("min_lead_minutes").notNull().default(120),
    maxAdvanceDays: integer("max_advance_days").notNull().default(30),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("centers_slug_uq").on(t.slug)],
);

export const users = sqliteTable(
  "users",
  {
    id: id(),
    /** null only for super_admin. */
    centerId: text("center_id").references(() => centers.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: text("role", { enum: ROLES }).notNull(),
    preferredLocale: text("preferred_locale", { enum: LOCALES }).notNull().default("ar"),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    totpSecret: text("totp_secret"),
    lastLoginAt: integer("last_login_at", { mode: "timestamp_ms" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("users_email_uq").on(t.email), index("users_center_idx").on(t.centerId)],
);

export const sessions = sqliteTable(
  "sessions",
  {
    /** SHA-256 (hex) of the session token. The token itself is only in the cookie. */
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Super admin support mode: the center being accessed. */
    supportCenterId: text("support_center_id").references(() => centers.id, { onDelete: "set null" }),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: createdAt(),
    userAgent: text("user_agent"),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

/** Fixed-window counter for failed logins, keyed by e.g. "login:email:<email>" or "login:ip:<ip>". */
export const rateLimits = sqliteTable("rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull(),
  windowStart: integer("window_start", { mode: "timestamp_ms" }).notNull(),
});

// ---------------------------------------------------------------- catalogue

export const specialties = sqliteTable(
  "specialties",
  {
    id: id(),
    centerId: centerId(),
    slug: text("slug").notNull(),
    nameAr: text("name_ar").notNull(),
    nameEn: text("name_en").notNull(),
    descriptionAr: text("description_ar"),
    descriptionEn: text("description_en"),
    icon: text("icon"),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("specialties_center_slug_uq").on(t.centerId, t.slug)],
);

export const doctors = sqliteTable(
  "doctors",
  {
    id: id(),
    centerId: centerId(),
    slug: text("slug").notNull(),
    nameAr: text("name_ar").notNull(),
    nameEn: text("name_en").notNull(),
    titleAr: text("title_ar"),
    titleEn: text("title_en"),
    photoUrl: text("photo_url"),
    bioAr: text("bio_ar"),
    bioEn: text("bio_en"),
    qualificationsAr: text("qualifications_ar"),
    qualificationsEn: text("qualifications_en"),
    /** JSON array of language codes spoken, e.g. ["ar","en"]. */
    languages: text("languages", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
    gender: text("gender", { enum: ["male", "female"] }),
    yearsExperience: integer("years_experience"),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("doctors_center_slug_uq").on(t.centerId, t.slug)],
);

export const doctorSpecialties = sqliteTable(
  "doctor_specialties",
  {
    doctorId: text("doctor_id")
      .notNull()
      .references(() => doctors.id, { onDelete: "cascade" }),
    specialtyId: text("specialty_id")
      .notNull()
      .references(() => specialties.id, { onDelete: "cascade" }),
    isPrimary: integer("is_primary", { mode: "boolean" }).notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.doctorId, t.specialtyId] })],
);

export const doctorServices = sqliteTable(
  "doctor_services",
  {
    id: id(),
    centerId: centerId(),
    doctorId: text("doctor_id")
      .notNull()
      .references(() => doctors.id, { onDelete: "cascade" }),
    bookingType: text("booking_type", { enum: BOOKING_TYPES }).notNull(),
    durationMinutes: integer("duration_minutes").notNull(),
    price: integer("price").notNull(),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    notesAr: text("notes_ar"),
    notesEn: text("notes_en"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("doctor_services_doctor_type_uq").on(t.doctorId, t.bookingType)],
);

// ---------------------------------------------------------------- scheduling

export const availabilitySessions = sqliteTable(
  "availability_sessions",
  {
    id: id(),
    centerId: centerId(),
    doctorId: text("doctor_id")
      .notNull()
      .references(() => doctors.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    startTime: text("start_time").notNull(),
    endTime: text("end_time").notNull(),
    status: text("status", { enum: ["open", "closed"] }).notNull().default("open"),
    note: text("note"),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("availability_doctor_date_idx").on(t.doctorId, t.date)],
);

export const patients = sqliteTable(
  "patients",
  {
    id: id(),
    centerId: centerId(),
    fullName: text("full_name").notNull(),
    /** E.164. Not unique: one phone can belong to several family members. */
    phone: text("phone").notNull(),
    gender: text("gender", { enum: ["male", "female"] }),
    dateOfBirth: text("date_of_birth"),
    preferredLocale: text("preferred_locale", { enum: LOCALES }).notNull().default("ar"),
    /** Administrative notes only. Never medical information. */
    notes: text("notes"),
    source: text("source", { enum: SOURCES }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("patients_center_phone_idx").on(t.centerId, t.phone)],
);

export const appointments = sqliteTable(
  "appointments",
  {
    id: id(),
    centerId: centerId(),
    referenceCode: text("reference_code").notNull(),
    patientId: text("patient_id")
      .notNull()
      .references(() => patients.id, { onDelete: "restrict" }),
    doctorId: text("doctor_id")
      .notNull()
      .references(() => doctors.id, { onDelete: "restrict" }),
    bookingType: text("booking_type", { enum: BOOKING_TYPES }).notNull(),
    sessionId: text("session_id").references(() => availabilitySessions.id, { onDelete: "set null" }),
    startAt: integer("start_at", { mode: "timestamp_ms" }).notNull(),
    endAt: integer("end_at", { mode: "timestamp_ms" }).notNull(),
    status: text("status", { enum: APPOINTMENT_STATUSES }).notNull(),
    source: text("source", { enum: SOURCES }).notNull(),
    priceSnapshot: integer("price_snapshot").notNull(),
    revisitFlag: integer("revisit_flag", { mode: "boolean" }).notNull().default(false),
    isOverride: integer("is_override", { mode: "boolean" }).notNull().default(false),
    patientNote: text("patient_note"),
    internalNote: text("internal_note"),
    cancelReason: text("cancel_reason"),
    cancelledBy: text("cancelled_by").references(() => users.id, { onDelete: "set null" }),
    confirmedAt: integer("confirmed_at", { mode: "timestamp_ms" }),
    checkedInAt: integer("checked_in_at", { mode: "timestamp_ms" }),
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),
    /** null when booked by the patient on the website. */
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("appointments_center_ref_uq").on(t.centerId, t.referenceCode),
    index("appointments_doctor_start_idx").on(t.doctorId, t.startAt),
    index("appointments_center_start_idx").on(t.centerId, t.startAt),
    index("appointments_patient_idx").on(t.patientId),
  ],
);

export const bookingRequests = sqliteTable(
  "booking_requests",
  {
    id: id(),
    centerId: centerId(),
    referenceCode: text("reference_code").notNull(),
    patientId: text("patient_id")
      .notNull()
      .references(() => patients.id, { onDelete: "restrict" }),
    doctorId: text("doctor_id")
      .notNull()
      .references(() => doctors.id, { onDelete: "restrict" }),
    bookingType: text("booking_type", { enum: BOOKING_TYPES }).notNull(),
    preferredDate: text("preferred_date"),
    preferredPeriod: text("preferred_period", { enum: PREFERRED_PERIODS }).notNull().default("any"),
    patientNote: text("patient_note"),
    status: text("status", { enum: REQUEST_STATUSES }).notNull().default("new"),
    appointmentId: text("appointment_id").references(() => appointments.id, { onDelete: "set null" }),
    handledBy: text("handled_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("booking_requests_center_ref_uq").on(t.centerId, t.referenceCode),
    index("booking_requests_center_status_idx").on(t.centerId, t.status),
  ],
);

// ---------------------------------------------------------------- money

export const payments = sqliteTable(
  "payments",
  {
    id: id(),
    centerId: centerId(),
    appointmentId: text("appointment_id")
      .notNull()
      .references(() => appointments.id, { onDelete: "restrict" }),
    amount: integer("amount").notNull(),
    method: text("method", { enum: ["cash"] }).notNull().default("cash"),
    receivedBy: text("received_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    receivedAt: integer("received_at", { mode: "timestamp_ms" }).notNull(),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [
    index("payments_center_received_idx").on(t.centerId, t.receivedAt),
    index("payments_appointment_idx").on(t.appointmentId),
  ],
);

/** A manager "closes" a day; payments received on a closed day are locked. */
export const cashDayClosures = sqliteTable(
  "cash_day_closures",
  {
    centerId: centerId(),
    date: text("date").notNull(),
    closedBy: text("closed_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    closedAt: integer("closed_at", { mode: "timestamp_ms" }).notNull(),
    total: integer("total").notNull(),
  },
  (t) => [primaryKey({ columns: [t.centerId, t.date] })],
);

// ---------------------------------------------------------------- messaging & audit

export const messageTemplates = sqliteTable(
  "message_templates",
  {
    id: id(),
    centerId: centerId(),
    key: text("key", { enum: MESSAGE_TEMPLATE_KEYS }).notNull(),
    bodyAr: text("body_ar").notNull(),
    bodyEn: text("body_en").notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("message_templates_center_key_uq").on(t.centerId, t.key)],
);

export const messageLog = sqliteTable(
  "message_log",
  {
    id: id(),
    centerId: centerId(),
    appointmentId: text("appointment_id").references(() => appointments.id, { onDelete: "cascade" }),
    requestId: text("request_id").references(() => bookingRequests.id, { onDelete: "cascade" }),
    templateKey: text("template_key", { enum: MESSAGE_TEMPLATE_KEYS }).notNull(),
    channel: text("channel", { enum: ["whatsapp_link"] }).notNull().default("whatsapp_link"),
    sentBy: text("sent_by").references(() => users.id, { onDelete: "set null" }),
    sentAt: integer("sent_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("message_log_appointment_idx").on(t.appointmentId)],
);

export const auditLog = sqliteTable(
  "audit_log",
  {
    id: id(),
    /** null for platform-level actions. */
    centerId: text("center_id").references(() => centers.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    entity: text("entity").notNull(),
    entityId: text("entity_id"),
    action: text("action").notNull(),
    changes: text("changes", { mode: "json" }).$type<Record<string, unknown>>(),
    isSupportAction: integer("is_support_action", { mode: "boolean" }).notNull().default(false),
    ip: text("ip"),
    at: integer("at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("audit_center_at_idx").on(t.centerId, t.at)],
);
