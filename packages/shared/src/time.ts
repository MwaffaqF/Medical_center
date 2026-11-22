/**
 * Calendar and time-zone helpers.
 *
 * - A "date" is a calendar day in the center's time zone: "YYYY-MM-DD".
 * - A "time" is a wall-clock time in the center's time zone: "HH:MM" (24h).
 * - Instants are epoch milliseconds (UTC).
 *
 * Conversions use Intl, so any IANA zone works (the pilot uses Asia/Damascus, UTC+3 all year).
 */

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidDate(date: string): boolean {
  const m = DATE_RE.exec(date);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!));
  return d.getUTCFullYear() === +m[1]! && d.getUTCMonth() === +m[2]! - 1 && d.getUTCDate() === +m[3]!;
}

export const isValidTime = (time: string): boolean => TIME_RE.test(time);

/** "HH:MM" → minutes since midnight. */
export function timeToMinutes(time: string): number {
  const m = TIME_RE.exec(time);
  if (!m) throw new Error(`invalid time: ${time}`);
  return +m[1]! * 60 + +m[2]!;
}

/** Minutes since midnight → "HH:MM". */
export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Calendar arithmetic on "YYYY-MM-DD" (no time zone involved). */
export function addDays(date: string, days: number): string {
  const m = DATE_RE.exec(date);
  if (!m) throw new Error(`invalid date: ${date}`);
  const d = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]! + days));
  return d.toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday. */
export function dayOfWeek(date: string): number {
  const m = DATE_RE.exec(date);
  if (!m) throw new Error(`invalid date: ${date}`);
  return new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!)).getUTCDay();
}

/** In Syria the week starts on Saturday. */
export const WEEK_STARTS_ON = 6;

/** The first day of the week containing `date`. */
export function weekStart(date: string, startsOn = WEEK_STARTS_ON): string {
  const diff = (dayOfWeek(date) - startsOn + 7) % 7;
  return addDays(date, -diff);
}

export function daysBetween(from: string, to: string): number {
  const a = DATE_RE.exec(from)!;
  const b = DATE_RE.exec(to)!;
  return Math.round((Date.UTC(+b[1]!, +b[2]! - 1, +b[3]!) - Date.UTC(+a[1]!, +a[2]! - 1, +a[3]!)) / 86_400_000);
}

const partsCache = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = partsCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    partsCache.set(timeZone, f);
  }
  return f;
}

/** Wall-clock parts of an instant in a time zone. */
export function zonedParts(instant: number, timeZone: string) {
  const parts = Object.fromEntries(formatter(timeZone).formatToParts(new Date(instant)).map((p) => [p.type, p.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
    seconds: Number(parts.second),
  };
}

/** Offset (minutes) of the time zone from UTC at an instant, e.g. +180 for Damascus. */
function offsetMinutes(instant: number, timeZone: string): number {
  const p = zonedParts(instant, timeZone);
  const [y, mo, d] = p.date.split("-").map(Number) as [number, number, number];
  const [h, mi] = p.time.split(":").map(Number) as [number, number];
  const asUtc = Date.UTC(y, mo - 1, d, h, mi, p.seconds);
  return Math.round((asUtc - Math.floor(instant / 1000) * 1000) / 60_000);
}

/** Center-local date + time → instant (epoch ms). */
export function zonedToUtc(date: string, time: string, timeZone: string): number {
  const [y, mo, d] = date.split("-").map(Number) as [number, number, number];
  const minutes = timeToMinutes(time);
  const naive = Date.UTC(y, mo - 1, d, Math.floor(minutes / 60), minutes % 60);
  // Two passes handle daylight-saving transitions.
  let guess = naive - offsetMinutes(naive, timeZone) * 60_000;
  guess = naive - offsetMinutes(guess, timeZone) * 60_000;
  return guess;
}

/** Today's date in the time zone. */
export const todayIn = (timeZone: string, now = Date.now()): string => zonedParts(now, timeZone).date;
