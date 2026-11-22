import { sql } from "drizzle-orm";
import { BLOCKING_STATUSES, type AppointmentStatus, type BookingType, type Source } from "@mc/shared";
import type { Database } from "../db/client";
import { referenceCode } from "../lib/tokens";

export type NewAppointment = {
  centerId: string;
  patientId: string;
  doctorId: string;
  bookingType: BookingType;
  sessionId: string | null;
  startAt: number;
  endAt: number;
  status: AppointmentStatus;
  source: Source;
  priceSnapshot: number;
  revisitFlag?: boolean;
  /** Reception override (spec §8.6): skip the session and overlap checks. */
  isOverride?: boolean;
  patientNote?: string | null;
  internalNote?: string | null;
  createdBy?: string | null;
};

export type InsertResult = { ok: true; id: string; referenceCode: string } | { ok: false; reason: "slot_taken" };

const blockingList = sql.raw(BLOCKING_STATUSES.map((s) => `'${s}'`).join(", "));

/**
 * Creates an appointment only if the time is still free — in ONE statement, so two people
 * booking the same slot at the same moment can never both succeed (spec §8.5).
 * D1 runs each statement atomically on a single primary database.
 *
 * Unless it is an override, the statement also requires the session to still be open
 * and to belong to the doctor. (The caller checks the slot fits inside the session times.)
 */
export async function insertAppointmentIfFree(db: Database, a: NewAppointment): Promise<InsertResult> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const id = crypto.randomUUID();
    const ref = referenceCode();
    const now = Date.now();
    const override = a.isOverride ? 1 : 0;
    try {
      const row = await db.get<{ id: string } | undefined>(sql`
        INSERT INTO appointments (
          id, center_id, reference_code, patient_id, doctor_id, booking_type, session_id,
          start_at, end_at, status, source, price_snapshot, revisit_flag, is_override,
          patient_note, internal_note, created_by, confirmed_at, checked_in_at, created_at, updated_at
        )
        SELECT
          ${id}, ${a.centerId}, ${ref}, ${a.patientId}, ${a.doctorId}, ${a.bookingType}, ${a.sessionId},
          ${a.startAt}, ${a.endAt}, ${a.status}, ${a.source}, ${a.priceSnapshot}, ${a.revisitFlag ? 1 : 0}, ${override},
          ${a.patientNote ?? null}, ${a.internalNote ?? null}, ${a.createdBy ?? null},
          ${a.status === "confirmed" || a.status === "checked_in" ? now : null},
          ${a.status === "checked_in" ? now : null},
          ${now}, ${now}
        WHERE (
          ${override} = 1 OR NOT EXISTS (
            SELECT 1 FROM appointments
            WHERE doctor_id = ${a.doctorId}
              AND status IN (${blockingList})
              AND start_at < ${a.endAt}
              AND end_at > ${a.startAt}
          )
        )
        AND (
          ${override} = 1 OR EXISTS (
            SELECT 1 FROM availability_sessions
            WHERE id = ${a.sessionId} AND doctor_id = ${a.doctorId} AND status = 'open'
          )
        )
        RETURNING id
      `);
      if (!row) return { ok: false, reason: "slot_taken" };
      return { ok: true, id: row.id, referenceCode: ref };
    } catch (e) {
      // Reference-code collision (1 in ~10^9 per center): retry with a new code.
      if (String(e).includes("appointments_center_ref_uq") || String(e).includes("reference_code")) continue;
      throw e;
    }
  }
  throw new Error("could not allocate a reference code");
}
