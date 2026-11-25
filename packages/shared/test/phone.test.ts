import { describe, expect, it } from "vitest";
import { normalizePhone, waNumber } from "../src/phone";

describe("normalizePhone (Syria default)", () => {
  it.each([
    ["0944123456", "+963944123456"],
    ["0944 123 456", "+963944123456"],
    ["944123456", "+963944123456"],
    ["963944123456", "+963944123456"],
    ["00963944123456", "+963944123456"],
    ["+963 944-123-456", "+963944123456"],
    ["٠٩٤٤١٢٣٤٥٦", "+963944123456"],
    ["+971501234567", "+971501234567"],
  ])("%s -> %s", (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each(["", "abc", "12", "0844123456", "+12"])("rejects %s", (input) => {
    expect(normalizePhone(input)).toBeNull();
  });

  it("builds wa.me numbers", () => {
    expect(waNumber("+963944123456")).toBe("963944123456");
  });
});
