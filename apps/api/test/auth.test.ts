import { describe, expect, it } from "vitest";
import { call, createCenter, createUser, login } from "./helpers";

describe("health", () => {
  it("responds", async () => {
    const res = await call("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });
});

describe("auth", () => {
  it("logs in a receptionist and returns the session user", async () => {
    const center = await createCenter();
    await createUser({ email: "rec@test.sy", password: "correct-horse", role: "receptionist", centerId: center.id });

    const { res, cookie } = await login("REC@test.sy ", "correct-horse");
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie")!;
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=Lax");

    const me = await call("/api/auth/me", { cookie });
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ user: { email: "rec@test.sy", role: "receptionist", centerId: center.id } });
  });

  it("rejects a wrong password with a generic error", async () => {
    const center = await createCenter();
    await createUser({ email: "a@test.sy", password: "right-password", role: "manager", centerId: center.id });
    const { res } = await login("a@test.sy", "wrong-password");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: { code: "invalid_credentials" } });
  });

  it("gives the same error for an unknown email", async () => {
    const { res } = await login("nobody@test.sy", "whatever-pass");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: { code: "invalid_credentials" } });
  });

  it("rejects inactive users", async () => {
    const center = await createCenter();
    await createUser({ email: "off@test.sy", password: "pw-1234567", role: "receptionist", centerId: center.id, isActive: false });
    expect((await login("off@test.sy", "pw-1234567")).res.status).toBe(401);
  });

  it("blocks staff of a suspended center", async () => {
    const center = await createCenter("closed", "suspended");
    await createUser({ email: "s@test.sy", password: "pw-1234567", role: "manager", centerId: center.id });
    const { res } = await login("s@test.sy", "pw-1234567");
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: { code: "center_suspended" } });
  });

  it("lets the super admin log in without a center", async () => {
    await createUser({ email: "root@test.sy", password: "pw-1234567", role: "super_admin", centerId: null });
    const { res, cookie } = await login("root@test.sy", "pw-1234567");
    expect(res.status).toBe(200);
    const me = await (await call("/api/auth/me", { cookie })).json();
    expect(me).toMatchObject({ user: { role: "super_admin", centerId: null, supportCenterId: null } });
  });

  it("throttles after 5 failed attempts for the same email", async () => {
    const center = await createCenter();
    await createUser({ email: "t@test.sy", password: "the-password", role: "receptionist", centerId: center.id });
    for (let i = 0; i < 5; i++) expect((await login("t@test.sy", "nope-nope")).res.status).toBe(401);
    const blocked = await login("t@test.sy", "the-password");
    expect(blocked.res.status).toBe(429);
  });

  it("logs out and invalidates the session", async () => {
    const center = await createCenter();
    await createUser({ email: "o@test.sy", password: "pw-1234567", role: "receptionist", centerId: center.id });
    const { cookie } = await login("o@test.sy", "pw-1234567");
    const out = await call("/api/auth/logout", { method: "POST", body: "{}", cookie });
    expect(out.status).toBe(200);
    expect((await call("/api/auth/me", { cookie })).status).toBe(401);
  });

  it("requires a session for /me", async () => {
    expect((await call("/api/auth/me")).status).toBe(401);
    expect((await call("/api/auth/me", { cookie: "mc_session=forged" })).status).toBe(401);
  });
});

describe("CSRF guard", () => {
  it("rejects non-JSON state-changing requests", async () => {
    const res = await call("/api/auth/login", {
      method: "POST",
      body: "email=a&password=b",
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });
    expect(res.status).toBe(415);
  });

  it("rejects cross-site origins", async () => {
    const res = await call("/api/auth/logout", { method: "POST", body: "{}", headers: { origin: "https://evil.example" } });
    expect(res.status).toBe(403);
  });
});
