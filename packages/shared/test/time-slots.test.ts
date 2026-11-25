import { describe, expect, it } from "vitest";
import { computeSlots, fitsInSession, type SlotSession } from "../src/slots";
import {
  addDays,
  dayOfWeek,
  daysBetween,
  isValidDate,
  isValidTime,
  minutesToTime,
  timeToMinutes,
  todayIn,
  weekStart,
  zonedParts,
  zonedToUtc,
} from "../src/time";

const TZ = "Asia/Damascus";

describe("calendar helpers", () => {
  it("validates dates and times", () => {
    expect(isValidDate("2026-11-28")).toBe(true);
    expect(isValidDate("2026-02-30")).toBe(false);
    expect(isValidDate("26-11-28")).toBe(false);
    expect(isValidTime("09:05")).toBe(true);
    expect(isValidTime("24:00")).toBe(false);
    expect(isValidTime("9:05")).toBe(false);
  });

  it("does date arithmetic across months and years", () => {
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
    expect(addDays("2027-03-01", -1)).toBe("2027-02-28");
    expect(daysBetween("2026-11-28", "2026-12-05")).toBe(7);
  });

  it("starts the week on Saturday", () => {
    expect(dayOfWeek("2026-11-28")).toBe(6); // Saturday
    expect(weekStart("2026-11-28")).toBe("2026-11-28");
    expect(weekStart("2026-12-04")).toBe("2026-11-28"); // Friday → previous Saturday
    expect(weekStart("2026-12-05")).toBe("2026-12-05");
  });

  it("converts minutes and times", () => {
    expect(timeToMinutes("16:30")).toBe(990);
    expect(minutesToTime(990)).toBe("16:30");
  });
});

describe("time zones", () => {
  it("Damascus is UTC+3", () => {
    const t = zonedToUtc("2026-11-28", "16:00", TZ);
    expect(new Date(t).toISOString()).toBe("2026-11-28T13:00:00.000Z");
    expect(zonedParts(t, TZ)).toMatchObject({ date: "2026-11-28", time: "16:00" });
  });

  it("handles the local date around midnight", () => {
    // 22:30 UTC on the 27th is 01:30 on the 28th in Damascus.
    expect(todayIn(TZ, Date.parse("2026-11-27T22:30:00Z"))).toBe("2026-11-28");
  });

  it("works across daylight-saving changes in other zones", () => {
    // Berlin: CET (+1) in winter, CEST (+2) in summer.
    expect(new Date(zonedToUtc("2026-01-15", "10:00", "Europe/Berlin")).toISOString()).toBe("2026-01-15T09:00:00.000Z");
    expect(new Date(zonedToUtc("2026-07-15", "10:00", "Europe/Berlin")).toISOString()).toBe("2026-07-15T08:00:00.000Z");
  });
});

describe("slot engine", () => {
  const session: SlotSession = { id: "s1", date: "2026-11-28", startTime: "16:00", endTime: "17:00", status: "open" };
  const now = Date.parse("2026-11-27T08:00:00Z");
  const rules = { timeZone: TZ, durationMinutes: 20, stepMinutes: 10, minLeadMinutes: 120, maxAdvanceDays: 30, now };
  const at = (time: string) => zonedToUtc("2026-11-28", time, TZ);

  it("steps through the session and only offers slots that fit", () => {
    const slots = computeSlots([session], [], rules);
    expect(slots.map((s) => s.time)).toEqual(["16:00", "16:10", "16:20", "16:30", "16:40"]);
    expect(slots[0]).toMatchObject({ sessionId: "s1", date: "2026-11-28", startAt: at("16:00"), endAt: at("16:20") });
  });

  it("skips times that overlap existing appointments (touching edges are fine)", () => {
    const busy = [{ startAt: at("16:20"), endAt: at("16:40") }];
    expect(computeSlots([session], busy, rules).map((s) => s.time)).toEqual(["16:00", "16:40"]);
  });

  it("uses the booking type's length", () => {
    expect(computeSlots([session], [], { ...rules, durationMinutes: 45 }).map((s) => s.time)).toEqual(["16:00", "16:10"]);
    expect(computeSlots([session], [], { ...rules, durationMinutes: 90 })).toEqual([]);
  });

  it("ignores closed sessions", () => {
    expect(computeSlots([{ ...session, status: "closed" }], [], rules)).toEqual([]);
  });

  it("applies the minimum notice and the booking window", () => {
    const soon = { ...rules, now: at("15:00") }; // 1 hour before the session, 2 hours notice required
    expect(computeSlots([session], [], soon)).toEqual([]);
    const withLead = { ...rules, now: at("14:15") }; // earliest = 16:15
    expect(computeSlots([session], [], withLead).map((s) => s.time)).toEqual(["16:20", "16:30", "16:40"]);
    const farAway = { ...rules, now: Date.parse("2026-10-01T08:00:00Z") };
    expect(computeSlots([session], [], farAway)).toEqual([]);
    expect(computeSlots([session], [], { ...farAway, maxAdvanceDays: null, minLeadMinutes: 0 })).toHaveLength(5);
  });

  it("sorts slots across sessions and days", () => {
    const later: SlotSession = { id: "s0", date: "2026-11-29", startTime: "09:00", endTime: "09:20", status: "open" };
    const slots = computeSlots([later, session], [], rules);
    expect(slots[0]!.date).toBe("2026-11-28");
    expect(slots.at(-1)).toMatchObject({ sessionId: "s0", time: "09:00" });
  });

  it("checks whether a range fits in a session", () => {
    expect(fitsInSession(session, at("16:40"), at("17:00"), TZ)).toBe(true);
    expect(fitsInSession(session, at("16:50"), at("17:10"), TZ)).toBe(false);
    expect(fitsInSession({ ...session, status: "closed" }, at("16:00"), at("16:20"), TZ)).toBe(false);
  });
});
