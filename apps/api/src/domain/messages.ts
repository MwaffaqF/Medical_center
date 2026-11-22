import { and, eq } from "drizzle-orm";
import { renderTemplate, t, whatsappLink, type Locale, type MessageTemplateKey } from "@mc/shared";
import type { Database } from "../db/client";
import { centers, doctors, doctorSpecialties, messageTemplates, specialties } from "../db/schema";
import { DEFAULT_TEMPLATES } from "./default-templates";

type CenterRow = typeof centers.$inferSelect;
type DoctorRow = typeof doctors.$inferSelect;

/**
 * Builds the pre-filled WhatsApp text for an appointment or a booking request (spec §13),
 * in the patient's preferred language, with the center's own template wording.
 */
export async function renderMessage(
  db: Database,
  input: {
    center: CenterRow;
    doctor: DoctorRow;
    templateKey: MessageTemplateKey;
    patient: { fullName: string; phone: string; preferredLocale: Locale };
    bookingType: "visit" | "revisit" | "session";
    startAt?: Date | null;
    price?: number | null;
    referenceCode: string;
  },
): Promise<{ text: string; url: string; locale: Locale }> {
  const { center, doctor, patient } = input;
  const locale = patient.preferredLocale;
  const tpl = await db.query.messageTemplates.findFirst({
    where: and(eq(messageTemplates.centerId, center.id), eq(messageTemplates.key, input.templateKey)),
  });
  const body = locale === "ar" ? (tpl?.bodyAr ?? DEFAULT_TEMPLATES[input.templateKey].ar) : (tpl?.bodyEn ?? DEFAULT_TEMPLATES[input.templateKey].en);

  const primary = await db
    .select({ nameAr: specialties.nameAr, nameEn: specialties.nameEn })
    .from(doctorSpecialties)
    .innerJoin(specialties, eq(specialties.id, doctorSpecialties.specialtyId))
    .where(and(eq(doctorSpecialties.doctorId, doctor.id), eq(doctorSpecialties.isPrimary, true)))
    .get();

  const tag = locale === "ar" ? "ar-SY-u-nu-latn" : "en-GB";
  const pick = (ar: string | null | undefined, en: string | null | undefined) => (locale === "ar" ? ar || en : en || ar) ?? "";
  const when = input.startAt ?? null;
  const vars = {
    patient_name: patient.fullName,
    doctor_name: pick(doctor.nameAr, doctor.nameEn),
    specialty: primary ? pick(primary.nameAr, primary.nameEn) : "",
    booking_type: t(locale, `booking.${input.bookingType}`),
    date: when ? new Intl.DateTimeFormat(tag, { weekday: "long", day: "numeric", month: "long", timeZone: center.timezone }).format(when) : "",
    time: when ? new Intl.DateTimeFormat(tag, { hour: "numeric", minute: "2-digit", timeZone: center.timezone }).format(when) : "",
    price:
      input.price === null || input.price === undefined
        ? ""
        : `${new Intl.NumberFormat(tag).format(input.price)} ${center.currency === "SYP" ? t(locale, "common.currency.SYP") : center.currency}`,
    reference: input.referenceCode,
    center_name: pick(center.nameAr, center.nameEn),
    center_address: pick(center.addressAr, center.addressEn),
    map_url: center.mapUrl ?? "",
  };
  const text = renderTemplate(body, vars).replace(/[ \t]{2,}/g, " ").trim();
  return { text, url: whatsappLink(patient.phone, text), locale };
}
