import { z } from "zod";
import { BOOKING_TYPES, CENTER_STATUSES, LOCALES, MESSAGE_TEMPLATE_KEYS, ROLES } from "./enums";
import { normalizePhone } from "./phone";
import { daysBetween, isValidDate, isValidTime, timeToMinutes } from "./time";

// ---------------------------------------------------------------- helpers

/** Trimmed string; empty becomes null (for optional text fields). */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

const requiredText = (max: number) => z.string().trim().min(1, "required").max(max);

/** Optional phone, normalised to E.164 (Syria by default). */
const optionalPhone = z
  .string()
  .trim()
  .max(30)
  .nullish()
  .transform((v, ctx) => {
    if (!v) return null;
    const p = normalizePhone(v);
    if (!p) {
      ctx.addIssue({ code: "custom", message: "invalid_phone" });
      return z.NEVER;
    }
    return p;
  });

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(60)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "invalid_slug");

const httpsUrl = z
  .string()
  .trim()
  .max(500)
  .nullish()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || /^https:\/\/\S+$/.test(v), "invalid_url");

// ---------------------------------------------------------------- auth

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const passwordSchema = z.string().min(10, "password_too_short").max(200);

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: passwordSchema,
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const totpCodeSchema = z.object({ code: z.string().trim().regex(/^\d{6}$/, "invalid_code") });

export const sessionUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  role: z.enum(ROLES),
  centerId: z.string().nullable(),
  /** Set when a super admin is working inside a center in support mode. */
  supportCenterId: z.string().nullable(),
  preferredLocale: z.enum(LOCALES),
  mustChangePassword: z.boolean(),
});
export type SessionUser = z.infer<typeof sessionUserSchema>;

/**
 * Why a signed-in session can't use the app yet:
 * - mfa_setup: super admin must set up two-factor authentication
 * - mfa: super admin must enter a two-factor code
 * - password: user must choose a new password
 */
export type SessionRestriction = "mfa_setup" | "mfa" | "password" | null;

export type MeResponse = { user: SessionUser; restriction: SessionRestriction };

export type ApiError = { error: { code: string; message?: string } };

// ---------------------------------------------------------------- platform (super admin)

export const centerCreateSchema = z.object({
  slug: slugSchema,
  nameAr: requiredText(120),
  nameEn: requiredText(120),
  phone: optionalPhone,
  whatsappPhone: optionalPhone,
});
export type CenterCreateInput = z.input<typeof centerCreateSchema>;

export const centerAdminUpdateSchema = z
  .object({
    slug: slugSchema,
    nameAr: requiredText(120),
    nameEn: requiredText(120),
    status: z.enum(CENTER_STATUSES),
  })
  .partial();
export type CenterAdminUpdateInput = z.input<typeof centerAdminUpdateSchema>;

export const STAFF_ROLES = ["manager", "receptionist", "doctor"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const userCreateSchema = z.object({
  name: requiredText(120),
  email: z.string().trim().toLowerCase().email().max(254),
  role: z.enum(STAFF_ROLES),
  preferredLocale: z.enum(LOCALES).default("ar"),
});
export type UserCreateInput = z.input<typeof userCreateSchema>;

export const userUpdateSchema = z
  .object({
    name: requiredText(120),
    role: z.enum(STAFF_ROLES),
    isActive: z.boolean(),
    preferredLocale: z.enum(LOCALES),
  })
  .partial();
export type UserUpdateInput = z.input<typeof userUpdateSchema>;

export const supportModeSchema = z.object({ centerId: z.string().min(1) });

// ---------------------------------------------------------------- center settings

export const SLOT_STEPS = [5, 10, 15, 20, 30] as const;

export const centerSettingsSchema = z
  .object({
    nameAr: requiredText(120),
    nameEn: requiredText(120),
    phone: optionalPhone,
    whatsappPhone: optionalPhone,
    addressAr: optionalText(300),
    addressEn: optionalText(300),
    mapUrl: httpsUrl,
    openingHoursAr: optionalText(500),
    openingHoursEn: optionalText(500),
    aboutAr: optionalText(3000),
    aboutEn: optionalText(3000),
    defaultLocale: z.enum(LOCALES),
    slotStepMinutes: z.number().int().refine((v) => (SLOT_STEPS as readonly number[]).includes(v), "invalid_step"),
    minLeadMinutes: z.number().int().min(0).max(7 * 24 * 60),
    maxAdvanceDays: z.number().int().min(1).max(180),
  })
  .partial();
export type CenterSettingsInput = z.input<typeof centerSettingsSchema>;

export const templatesUpdateSchema = z.object({
  templates: z
    .array(
      z.object({
        key: z.enum(MESSAGE_TEMPLATE_KEYS),
        bodyAr: requiredText(1000),
        bodyEn: requiredText(1000),
      }),
    )
    .min(1)
    .max(MESSAGE_TEMPLATE_KEYS.length),
});
export type TemplatesUpdateInput = z.input<typeof templatesUpdateSchema>;

// ---------------------------------------------------------------- catalogue

export const specialtySchema = z.object({
  slug: slugSchema.optional(),
  nameAr: requiredText(120),
  nameEn: requiredText(120),
  descriptionAr: optionalText(2000),
  descriptionEn: optionalText(2000),
  icon: optionalText(40),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
  isActive: z.boolean().default(true),
});
export type SpecialtyInput = z.input<typeof specialtySchema>;
export const specialtyUpdateSchema = specialtySchema.partial();

export const doctorSchema = z.object({
  slug: slugSchema.optional(),
  nameAr: requiredText(120),
  nameEn: requiredText(120),
  titleAr: optionalText(160),
  titleEn: optionalText(160),
  bioAr: optionalText(4000),
  bioEn: optionalText(4000),
  qualificationsAr: optionalText(2000),
  qualificationsEn: optionalText(2000),
  languages: z.array(z.string().trim().min(2).max(20)).max(10).default([]),
  gender: z.enum(["male", "female"]).nullish().transform((v) => v ?? null),
  yearsExperience: z.number().int().min(0).max(80).nullish().transform((v) => v ?? null),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
  isActive: z.boolean().default(true),
  specialtyIds: z.array(z.string().min(1)).max(10).default([]),
  primarySpecialtyId: z.string().min(1).nullish().transform((v) => v ?? null),
});
export type DoctorInput = z.input<typeof doctorSchema>;
export const doctorUpdateSchema = doctorSchema.partial();

export const doctorServiceSchema = z.object({
  bookingType: z.enum(BOOKING_TYPES),
  durationMinutes: z.number().int().min(5).max(480),
  price: z.number().int().min(0).max(1_000_000_000),
  isActive: z.boolean().default(true),
  notesAr: optionalText(300),
  notesEn: optionalText(300),
});
export const doctorServicesSchema = z.object({
  services: z
    .array(doctorServiceSchema)
    .max(BOOKING_TYPES.length)
    .refine((list) => new Set(list.map((s) => s.bookingType)).size === list.length, "duplicate_booking_type"),
});
export type DoctorServicesInput = z.input<typeof doctorServicesSchema>;

export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

// ---------------------------------------------------------------- availability (spec §8, §11.7)

const dateSchema = z.string().refine(isValidDate, "invalid_date");
const timeSchema = z.string().refine(isValidTime, "invalid_time");

export const availabilityCreateSchema = z
  .object({
    doctorId: z.string().min(1),
    date: dateSchema,
    startTime: timeSchema,
    endTime: timeSchema,
    note: optionalText(300),
  })
  .refine((v) => !isValidTime(v.startTime) || !isValidTime(v.endTime) || timeToMinutes(v.endTime) > timeToMinutes(v.startTime), {
    message: "end_before_start",
    path: ["endTime"],
  });
export type AvailabilityCreateInput = z.input<typeof availabilityCreateSchema>;

export const availabilityUpdateSchema = z.object({
  startTime: timeSchema.optional(),
  endTime: timeSchema.optional(),
  status: z.enum(["open", "closed"]).optional(),
  note: optionalText(300),
  /** Apply even though booked appointments fall outside the new times (reception will contact them). */
  confirm: z.boolean().default(false),
});
export type AvailabilityUpdateInput = z.input<typeof availabilityUpdateSchema>;

export const availabilityQuerySchema = z
  .object({ doctorId: z.string().optional(), from: dateSchema, to: dateSchema })
  .refine((v) => !isValidDate(v.from) || !isValidDate(v.to) || (daysBetween(v.from, v.to) >= 0 && daysBetween(v.from, v.to) <= 62), {
    message: "invalid_range",
    path: ["to"],
  });

export const copyWeekSchema = z.object({
  fromWeek: dateSchema,
  toWeek: dateSchema,
  /** Copy one doctor's sessions, or every doctor's when omitted. */
  doctorId: z.string().min(1).optional(),
  dryRun: z.boolean().default(true),
});
export type CopyWeekInput = z.input<typeof copyWeekSchema>;

export const slotsQuerySchema = z.object({
  bookingType: z.enum(BOOKING_TYPES),
  from: dateSchema,
  days: z.coerce.number().int().min(1).max(31).default(7),
});
