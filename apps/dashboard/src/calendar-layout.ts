import { timeToMinutes, zonedParts } from "@mc/shared";

/** Minutes since local midnight of an instant, in the center's time zone. */
export function minuteOfDay(instant: number, timeZone: string): number {
  return timeToMinutes(zonedParts(instant, timeZone).time);
}

/**
 * Visible hours of the grid: at least 08:00–20:00, widened to whole hours
 * so every session and appointment fits.
 */
export function visibleRange(blocks: { start: number; end: number }[]): { start: number; end: number } {
  let start = 8 * 60;
  let end = 20 * 60;
  for (const b of blocks) {
    start = Math.min(start, Math.floor(b.start / 60) * 60);
    end = Math.max(end, Math.ceil(b.end / 60) * 60);
  }
  return { start: Math.max(0, start), end: Math.min(24 * 60, end) };
}

export type Placed<T> = T & { lane: number; lanes: number };

/**
 * Side-by-side placement for overlapping items in one column (overrides can overlap):
 * each item gets a lane, and every item in a group of overlapping items shares the group's lane count.
 */
export function placeInLanes<T extends { start: number; end: number }>(items: T[]): Placed<T>[] {
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end);
  const out: Placed<T>[] = [];
  let group: Placed<T>[] = [];
  let laneEnds: number[] = [];
  let groupEnd = -Infinity;

  const flush = () => {
    for (const p of group) p.lanes = laneEnds.length;
    out.push(...group);
    group = [];
    laneEnds = [];
  };

  for (const item of sorted) {
    if (item.start >= groupEnd) {
      flush();
      groupEnd = -Infinity;
    }
    let lane = laneEnds.findIndex((end) => end <= item.start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(item.end);
    } else {
      laneEnds[lane] = item.end;
    }
    group.push({ ...item, lane, lanes: 1 });
    groupEnd = Math.max(groupEnd, item.end);
  }
  flush();
  return out;
}

/** The start time ("HH:MM") for a click at `offsetMinutes` into the grid, rounded down to the slot step. */
export function clickToTime(rangeStart: number, offsetMinutes: number, step: number): string {
  const m = Math.max(0, Math.min(24 * 60 - step, rangeStart + Math.floor(offsetMinutes / step) * step));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
