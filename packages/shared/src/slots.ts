import { zonedParts, zonedToUtc } from "./time";

/**
 * Slot engine (spec §8). Pure: no database access, so the website, the dashboard and the
 * API all compute the same slots, and it is easy to test.
 */

export type SlotSession = {
  id: string;
  date: string; // YYYY-MM-DD, center time zone
  startTime: string; // HH:MM
  endTime: string; // HH:MM
  status: "open" | "closed";
};

/** Existing appointments that occupy the doctor's time (pending, confirmed, checked-in). */
export type BusyRange = { startAt: number; endAt: number };

export type SlotRules = {
  timeZone: string;
  durationMinutes: number;
  stepMinutes: number;
  /** Earliest start = now + minLeadMinutes (0 for reception). */
  minLeadMinutes: number;
  /** Latest start: within this many days from now (null = no limit, for reception). */
  maxAdvanceDays: number | null;
  now: number;
};

export type Slot = {
  sessionId: string;
  date: string;
  time: string; // HH:MM local start
  startAt: number;
  endAt: number;
};

export function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export function computeSlots(sessions: SlotSession[], busy: BusyRange[], rules: SlotRules): Slot[] {
  const { timeZone, durationMinutes, stepMinutes, minLeadMinutes, maxAdvanceDays, now } = rules;
  if (durationMinutes <= 0 || stepMinutes <= 0) return [];
  const duration = durationMinutes * 60_000;
  const step = stepMinutes * 60_000;
  const earliest = now + minLeadMinutes * 60_000;
  const latest = maxAdvanceDays === null ? Number.POSITIVE_INFINITY : now + maxAdvanceDays * 86_400_000;
  const sortedBusy = [...busy].sort((a, b) => a.startAt - b.startAt);

  const slots: Slot[] = [];
  for (const s of sessions) {
    if (s.status !== "open") continue;
    const sessionStart = zonedToUtc(s.date, s.startTime, timeZone);
    const sessionEnd = zonedToUtc(s.date, s.endTime, timeZone);
    for (let t = sessionStart; t + duration <= sessionEnd; t += step) {
      if (t < earliest || t > latest) continue;
      const end = t + duration;
      if (sortedBusy.some((b) => overlaps(t, end, b.startAt, b.endAt))) continue;
      slots.push({ sessionId: s.id, date: s.date, time: zonedParts(t, timeZone).time, startAt: t, endAt: end });
    }
  }
  return slots.sort((a, b) => a.startAt - b.startAt);
}

/** Does [startAt, endAt) fit entirely inside the session? */
export function fitsInSession(session: SlotSession, startAt: number, endAt: number, timeZone: string): boolean {
  return (
    session.status === "open" &&
    startAt >= zonedToUtc(session.date, session.startTime, timeZone) &&
    endAt <= zonedToUtc(session.date, session.endTime, timeZone)
  );
}
