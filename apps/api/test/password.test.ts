import { describe, expect, it } from "vitest";
import { DUMMY_HASH, hashPassword, verifyPassword } from "../src/lib/password";
import { referenceCode } from "../src/lib/tokens";

describe("password hashing", () => {
  it("verifies the right password and rejects others", async () => {
    const hash = await hashPassword("s3cret-pass");
    expect(hash).toMatch(/^pbkdf2\$sha256\$100000\$/);
    expect(await verifyPassword("s3cret-pass", hash)).toBe(true);
    expect(await verifyPassword("S3cret-pass", hash)).toBe(false);
  });

  it("uses a unique salt per hash", async () => {
    expect(await hashPassword("same")).not.toBe(await hashPassword("same"));
  });

  it("rejects malformed hashes and never matches the dummy hash", async () => {
    expect(await verifyPassword("x", "garbage")).toBe(false);
    expect(await verifyPassword("x", "pbkdf2$sha256$999999999$AA==$AA==")).toBe(false);
    expect(await verifyPassword("", DUMMY_HASH)).toBe(false);
  });
});

describe("reference codes", () => {
  it("have the XXX-XXX shape without ambiguous characters", () => {
    for (let i = 0; i < 200; i++) expect(referenceCode()).toMatch(/^[2-9A-HJ-NP-Z]{3}-[2-9A-HJ-NP-Z]{3}$/);
  });
});
