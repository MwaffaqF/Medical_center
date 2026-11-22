import type { BookingType, Locale, MessageTemplateKey, Role } from "@mc/shared";

/** API response shapes (dates arrive as ISO strings or epoch numbers over JSON). */
export type Center = {
  id: string;
  slug: string;
  status: "active" | "suspended";
  nameAr: string;
  nameEn: string;
  logoUrl: string | null;
  phone: string | null;
  whatsappPhone: string | null;
  addressAr: string | null;
  addressEn: string | null;
  mapUrl: string | null;
  openingHoursAr: string | null;
  openingHoursEn: string | null;
  aboutAr: string | null;
  aboutEn: string | null;
  timezone: string;
  currency: string;
  defaultLocale: Locale;
  slotStepMinutes: number;
  minLeadMinutes: number;
  maxAdvanceDays: number;
};

export type CenterWithCounts = Center & { userCount: number; doctorCount: number };

export type StaffUser = {
  id: string;
  centerId: string | null;
  name: string;
  email: string;
  role: Role;
  preferredLocale: Locale;
  isActive: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
};

export type Specialty = {
  id: string;
  slug: string;
  nameAr: string;
  nameEn: string;
  descriptionAr: string | null;
  descriptionEn: string | null;
  icon: string | null;
  sortOrder: number;
  isActive: boolean;
};

export type DoctorService = {
  id: string;
  bookingType: BookingType;
  durationMinutes: number;
  price: number;
  isActive: boolean;
  notesAr: string | null;
  notesEn: string | null;
};

export type Doctor = {
  id: string;
  slug: string;
  nameAr: string;
  nameEn: string;
  titleAr: string | null;
  titleEn: string | null;
  photoUrl: string | null;
  bioAr: string | null;
  bioEn: string | null;
  qualificationsAr: string | null;
  qualificationsEn: string | null;
  languages: string[];
  gender: "male" | "female" | null;
  yearsExperience: number | null;
  sortOrder: number;
  isActive: boolean;
  specialtyIds: string[];
  primarySpecialtyId: string | null;
  services: DoctorService[];
};

export type MessageTemplate = { id: string; key: MessageTemplateKey; bodyAr: string; bodyEn: string };

export type ActivityItem = {
  id: string;
  at: string;
  centerId: string | null;
  entity: string;
  entityId: string | null;
  action: string;
  isSupportAction: boolean;
  ip: string | null;
  userName: string | null;
  userEmail: string | null;
};

export type AvailabilitySession = {
  id: string;
  doctorId: string;
  date: string;
  startTime: string;
  endTime: string;
  status: "open" | "closed";
  note: string | null;
  bookedCount: number;
};

export type AffectedAppointment = {
  id: string;
  doctorId: string;
  startAt: string;
  endAt: string;
  status: string;
  referenceCode: string;
  patientName: string;
  patientPhone: string;
};

type PlannedSession = { doctorId: string; date: string; startTime: string; endTime: string };
export type CopyWeekResult = {
  fromWeek: string;
  toWeek: string;
  dryRun: boolean;
  planned: PlannedSession[];
  skipped: (PlannedSession & { reason: string })[];
};

export type SlotsResult = {
  bookingType: BookingType;
  durationMinutes: number;
  price: number;
  days: { date: string; slots: { sessionId: string; date: string; time: string; startAt: number; endAt: number }[] }[];
};
