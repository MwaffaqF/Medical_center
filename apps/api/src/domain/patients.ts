import { and, eq, sql } from "drizzle-orm";
import type { Locale, Source } from "@mc/shared";
import type { Database } from "../db/client";
import { appointments, patients } from "../db/schema";

/**
 * Finds the patient with this phone AND name in the center, or creates one.
 * One phone can belong to several family members (spec §5), so the phone alone is not an identity.
 */
export async function findOrCreatePatient(
  db: Database,
  centerId: string,
  input: { fullName: string; phone: string; preferredLocale: Locale; source: Source },
) {
  const name = input.fullName.trim().replace(/\s+/g, " ");
  const existing = await db.query.patients.findFirst({
    where: and(
      eq(patients.centerId, centerId),
      eq(patients.phone, input.phone),
      sql`lower(${patients.fullName}) = lower(${name})`,
    ),
  });
  if (existing) return existing;
  const [created] = await db
    .insert(patients)
    .values({ centerId, fullName: name, phone: input.phone, preferredLocale: input.preferredLocale, source: input.source })
    .returning();
  return created!;
}

/** A re-visit needs an earlier completed appointment with the same doctor (spec D6). */
export async function hasCompletedVisit(db: Database, patientId: string, doctorId: string): Promise<boolean> {
  const row = await db.query.appointments.findFirst({
    where: and(eq(appointments.patientId, patientId), eq(appointments.doctorId, doctorId), eq(appointments.status, "completed")),
    columns: { id: true },
  });
  return !!row;
}
