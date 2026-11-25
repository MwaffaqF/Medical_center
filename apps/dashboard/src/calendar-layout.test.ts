import { describe, expect, it } from "vitest";
import { zonedToUtc } from "@mc/shared";
import { clickToTime, minuteOfDay, placeInLanes, visibleRange } from "./calendar-layout";

describe("calendar layout", () => {
  it("reads the local minute of an instant in the center's time zone", () => {
    expect(minuteOfDay(zonedToUtc("2026-12-05", "09:30", "Asia/Damascus"), "Asia/Damascus")).toBe(570);
  });

  it("shows 08:00–20:00 by default and widens to whole hours", () => {
    expect(visibleRange([])).toEqual({ start: 480, end: 1200 });
    expect(visibleRange([{ start: 7 * 60 + 30, end: 21 * 60 + 10 }])).toEqual({ start: 420, end: 1320 });
  });

  it("puts overlapping appointments side by side and others full width", () => {
    const placed = placeInLanes([
      { id: "a", start: 600, end: 630 },
      { id: "b", start: 610, end: 640 },
      { id: "c", start: 640, end: 660 },
    ]);
    const byId = Object.fromEntries(placed.map((p) => [p.id, p]));
    expect(byId.a).toMatchObject({ lane: 0, lanes: 2 });
    expect(byId.b).toMatchObject({ lane: 1, lanes: 2 });
    expect(byId.c).toMatchObject({ lane: 0, lanes: 1 });
  });

  it("reuses a free lane inside a group", () => {
    const placed = placeInLanes([
      { id: "long", start: 600, end: 700 },
      { id: "x", start: 600, end: 620 },
      { id: "y", start: 630, end: 650 },
    ]);
    expect(placed.find((p) => p.id === "y")).toMatchObject({ lane: 1, lanes: 2 });
  });

  it("rounds a click down to the slot step", () => {
    expect(clickToTime(480, 47, 10)).toBe("08:40");
    expect(clickToTime(480, 0, 15)).toBe("08:00");
  });
});
