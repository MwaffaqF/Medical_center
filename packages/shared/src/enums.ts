export const LOCALES = ["ar", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "ar";
export const localeDir = (l: Locale): "rtl" | "ltr" => (l === "ar" ? "rtl" : "ltr");

export const ROLES = ["super_admin", "manager", "receptionist", "doctor"] as const;
export type Role = (typeof ROLES)[number];

export const BOOKING_TYPES = ["visit", "revisit", "session"] as const;
export type BookingType = (typeof BOOKING_TYPES)[number];

export const APPOINTMENT_STATUSES = [
  "pending",
  "confirmed",
  "checked_in",
  "completed",
  "no_show",
  "cancelled",
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

/** Statuses that occupy a slot in the doctor's calendar. */
export const BLOCKING_STATUSES: readonly AppointmentStatus[] = ["pending", "confirmed", "checked_in"];

export const SOURCES = ["website", "whatsapp", "phone", "walk_in"] as const;
export type Source = (typeof SOURCES)[number];

export const REQUEST_STATUSES = ["new", "contacted", "converted", "declined"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const PREFERRED_PERIODS = ["morning", "afternoon", "evening", "any"] as const;
export type PreferredPeriod = (typeof PREFERRED_PERIODS)[number];

export const CENTER_STATUSES = ["active", "suspended"] as const;
export type CenterStatus = (typeof CENTER_STATUSES)[number];

export const MESSAGE_TEMPLATE_KEYS = [
  "confirmation",
  "reminder",
  "rescheduled",
  "cancelled",
  "request_followup",
] as const;
export type MessageTemplateKey = (typeof MESSAGE_TEMPLATE_KEYS)[number];
