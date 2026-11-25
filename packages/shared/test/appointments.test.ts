import { describe, expect, it } from "vitest";
import { availableActions, nextStatus, renderTemplate, whatsappLink } from "../src/appointments";

describe("appointment lifecycle", () => {
  it("allows only valid transitions", () => {
    expect(nextStatus("pending", "confirm")).toBe("confirmed");
    expect(nextStatus("confirmed", "confirm")).toBeNull();
    expect(nextStatus("checked_in", "complete")).toBe("completed");
    expect(nextStatus("completed", "cancel")).toBeNull();
    expect(nextStatus("no_show", "reopen")).toBe("confirmed");
    expect(nextStatus("checked_in", "no_show")).toBeNull();
  });
  it("lists actions per status", () => {
    expect(availableActions("pending")).toEqual(["confirm", "check_in", "no_show", "cancel"]);
    expect(availableActions("completed")).toEqual([]);
  });
});

describe("templates", () => {
  it("fills placeholders, blanks empty values and keeps unknown ones", () => {
    expect(renderTemplate("Hi {patient_name}, {map_url} {typo}", { patient_name: "Sara", map_url: null })).toBe("Hi Sara,  {typo}");
  });
  it("builds wa.me links", () => {
    expect(whatsappLink("+963944123456", "مرحباً 1")).toBe("https://wa.me/963944123456?text=%D9%85%D8%B1%D8%AD%D8%A8%D8%A7%D9%8B%201");
  });
});
