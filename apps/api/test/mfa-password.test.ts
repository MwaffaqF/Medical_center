import { describe, expect, it } from "vitest";
import { currentStep, totpAt, verifyTotp } from "../src/lib/totp";
import { call, createCenter, createUser, json, login, loginSuperAdmin } from "./helpers";

describe("TOTP", () => {
  it("matches the RFC 6238 SHA-1 test vector", async () => {
    // Secret "12345678901234567890" (ASCII) in base32; T=59s → step 1 → 94287082 → last 6 digits.
    const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    expect(await totpAt(secret, 1)).toBe("287082");
    expect(await totpAt(secret, Math.floor(1111111109 / 30))).toBe("081804");
  });

  it("accepts ±1 step and refuses replays", async () => {
    const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    const now = 1_700_000_000_000;
    const step = currentStep(now);
    const prev = await totpAt(secret, step - 1);
    expect(await verifyTotp(secret, prev, null, now)).toBe(step - 1);
    expect(await verifyTotp(secret, prev, step - 1, now)).toBeNull();
    expect(await verifyTotp(secret, await totpAt(secret, step - 3), null, now)).toBeNull();
  });
});

describe("super admin two-factor sign-in", () => {
  it("blocks the admin API until 2FA is set up", async () => {
    await createUser({ email: "boss@test.sy", password: "boss-password", role: "super_admin", centerId: null });
    const { cookie } = await login("boss@test.sy", "boss-password");
    const res = await call("/api/admin/centers", { cookie });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: { code: "mfa_required" } });
  });

  it("sets up 2FA, then requires a code on the next sign-in", async () => {
    const { cookie, secret, email, password } = await loginSuperAdmin();
    expect((await call("/api/admin/centers", { cookie })).status).toBe(200);

    const second = await login(email, password);
    expect(await second.res.json()).toMatchObject({ restriction: "mfa" });
    expect((await call("/api/admin/centers", { cookie: second.cookie })).status).toBe(403);

    const bad = await call("/api/auth/mfa/verify", { method: "POST", body: json({ code: "000000" }), cookie: second.cookie });
    expect(bad.status).toBe(400);

    // The setup code's step was already used; the next step's code is accepted.
    const code = await totpAt(secret, currentStep() + 1);
    const ok = await call("/api/auth/mfa/verify", { method: "POST", body: json({ code }), cookie: second.cookie });
    expect(ok.status).toBe(200);
    expect((await call("/api/admin/centers", { cookie: second.cookie })).status).toBe(200);

    // Setup can't be restarted once enabled.
    const again = await call("/api/auth/mfa/setup", { method: "POST", body: "{}", cookie: second.cookie });
    expect(again.status).toBe(409);
  });

  it("stores the TOTP secret encrypted", async () => {
    const { secret, email } = await loginSuperAdmin();
    const { db } = await import("./helpers");
    const row = await db().query.users.findFirst({ where: (u, { eq }) => eq(u.email, email) });
    expect(row!.totpSecret).toMatch(/^v1\./);
    expect(row!.totpSecret).not.toContain(secret);
  });
});

describe("forced password change", () => {
  it("restricts a user with a temporary password until they change it", async () => {
    const center = await createCenter();
    const { db } = await import("./helpers");
    const user = await createUser({ email: "new@test.sy", password: "temp-pass-123", role: "receptionist", centerId: center.id });
    const { users } = await import("../src/db/schema");
    const { eq } = await import("drizzle-orm");
    await db().update(users).set({ mustChangePassword: true }).where(eq(users.id, user.id));

    const { res, cookie } = await login("new@test.sy", "temp-pass-123");
    expect(await res.json()).toMatchObject({ restriction: "password" });
    const blocked = await call("/api/center/settings", { cookie });
    expect(await blocked.json()).toEqual({ error: { code: "password_change_required" } });

    const short = await call("/api/auth/change-password", {
      method: "POST",
      body: json({ currentPassword: "temp-pass-123", newPassword: "short" }),
      cookie,
    });
    expect(short.status).toBe(400);
    expect(await short.json()).toMatchObject({ error: { code: "validation_failed", fields: { newPassword: "password_too_short" } } });

    const wrong = await call("/api/auth/change-password", {
      method: "POST",
      body: json({ currentPassword: "nope", newPassword: "a-much-better-password" }),
      cookie,
    });
    expect(await wrong.json()).toEqual({ error: { code: "wrong_current_password" } });

    const ok = await call("/api/auth/change-password", {
      method: "POST",
      body: json({ currentPassword: "temp-pass-123", newPassword: "a-much-better-password" }),
      cookie,
    });
    expect(ok.status).toBe(200);
    expect((await call("/api/center/settings", { cookie })).status).toBe(200);
    expect((await login("new@test.sy", "a-much-better-password")).res.status).toBe(200);
  });
});
