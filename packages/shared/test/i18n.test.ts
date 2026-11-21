import { describe, expect, it } from "vitest";
import ar from "../src/i18n/ar.json";
import en from "../src/i18n/en.json";
import { t } from "../src/i18n";

describe("i18n", () => {
  it("Arabic and English have the same keys", () => {
    expect(Object.keys(ar).sort()).toEqual(Object.keys(en).sort());
  });
  it("interpolates", () => {
    expect(t("en", "dashboard.welcome", { name: "Sara" })).toBe("Welcome, Sara");
  });
});
