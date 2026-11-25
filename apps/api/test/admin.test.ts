import { describe, expect, it } from "vitest";
import { call, createCenter, createUser, json, login, loginSuperAdmin, managerSession } from "./helpers";

describe("platform console: centers", () => {
  it("is closed to center staff", async () => {
    const { cookie } = await managerSession();
    expect((await call("/api/admin/centers", { cookie })).status).toBe(403);
    expect((await call("/api/admin/centers")).status).toBe(401);
  });

  it("creates a center with default WhatsApp templates and lists it", async () => {
    const { cookie } = await loginSuperAdmin();
    const res = await call("/api/admin/centers", {
      method: "POST",
      cookie,
      body: json({ slug: "al-shifa", nameAr: "مركز الشفاء", nameEn: "Al-Shifa Center", whatsappPhone: "0944 123 456" }),
    });
    expect(res.status).toBe(201);
    const { center } = (await res.json()) as { center: { id: string; whatsappPhone: string; timezone: string; currency: string } };
    expect(center).toMatchObject({ whatsappPhone: "+963944123456", timezone: "Asia/Damascus", currency: "SYP" });

    const dup = await call("/api/admin/centers", { method: "POST", cookie, body: json({ slug: "al-shifa", nameAr: "x", nameEn: "x" }) });
    expect(dup.status).toBe(409);

    await call(`/api/admin/centers/${center.id}/users`, { method: "POST", cookie, body: json({ name: "M", email: "m@al-shifa.sy", role: "manager" }) });
    const list = (await (await call("/api/admin/centers", { cookie })).json()) as { centers: { slug: string; userCount: number; doctorCount: number }[] };
    expect(list.centers.find((c) => c.slug === "al-shifa")).toMatchObject({ userCount: 1, doctorCount: 0 });
  });

  it("validates input with field-level errors", async () => {
    const { cookie } = await loginSuperAdmin();
    const res = await call("/api/admin/centers", {
      method: "POST",
      cookie,
      body: json({ slug: "Bad Slug!", nameAr: "", nameEn: "X", phone: "12" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { fields: Record<string, string> } };
    expect(Object.keys(body.error.fields).sort()).toEqual(["nameAr", "phone", "slug"]);
  });

  it("suspending a center signs its staff out and blocks sign-in", async () => {
    const { cookie: admin } = await loginSuperAdmin();
    const { center, cookie: staff } = await managerSession();
    expect((await call("/api/center/settings", { cookie: staff })).status).toBe(200);

    const res = await call(`/api/admin/centers/${center.id}`, { method: "PATCH", cookie: admin, body: json({ status: "suspended" }) });
    expect(res.status).toBe(200);
    expect((await call("/api/center/settings", { cookie: staff })).status).toBe(401);
  });
});

describe("platform console: center users", () => {
  it("creates a manager with a one-time password they must change", async () => {
    const { cookie } = await loginSuperAdmin();
    const center = await createCenter();
    const res = await call(`/api/admin/centers/${center.id}/users`, {
      method: "POST",
      cookie,
      body: json({ name: "Dr. Manager", email: "Boss@Center.sy", role: "manager" }),
    });
    expect(res.status).toBe(201);
    const { user, temporaryPassword } = (await res.json()) as { user: { email: string; mustChangePassword: boolean }; temporaryPassword: string };
    expect(user).toMatchObject({ email: "boss@center.sy", mustChangePassword: true });
    expect(user).not.toHaveProperty("passwordHash");
    expect(temporaryPassword).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/);

    const signIn = await login("boss@center.sy", temporaryPassword);
    expect(await signIn.res.json()).toMatchObject({ restriction: "password" });

    const dup = await call(`/api/admin/centers/${center.id}/users`, {
      method: "POST",
      cookie,
      body: json({ name: "x", email: "boss@center.sy", role: "receptionist" }),
    });
    expect(dup.status).toBe(409);
  });

  it("resets a password and deactivates a user, revoking their sessions", async () => {
    const { cookie } = await loginSuperAdmin();
    const center = await createCenter();
    const u = await createUser({ email: "r@c.sy", password: "old-password-1", role: "receptionist", centerId: center.id });
    const staff = await login("r@c.sy", "old-password-1");

    const reset = await call(`/api/admin/users/${u.id}/reset-password`, { method: "POST", body: "{}", cookie });
    const { temporaryPassword } = (await reset.json()) as { temporaryPassword: string };
    expect((await call("/api/auth/me", { cookie: staff.cookie })).status).toBe(401);
    expect((await login("r@c.sy", "old-password-1")).res.status).toBe(401);
    expect((await login("r@c.sy", temporaryPassword)).res.status).toBe(200);

    const off = await call(`/api/admin/users/${u.id}`, { method: "PATCH", cookie, body: json({ isActive: false }) });
    expect(off.status).toBe(200);
    expect((await login("r@c.sy", temporaryPassword)).res.status).toBe(401);
  });

  it("cannot touch super admin accounts", async () => {
    const { cookie } = await loginSuperAdmin();
    const other = await createUser({ email: "root2@test.sy", password: "x-password-1", role: "super_admin", centerId: null });
    expect((await call(`/api/admin/users/${other.id}`, { method: "PATCH", cookie, body: json({ isActive: false }) })).status).toBe(404);
  });
});

describe("support mode", () => {
  it("lets the super admin act inside a center, logging every action as support", async () => {
    const { cookie } = await loginSuperAdmin();
    const center = await createCenter();

    expect((await call("/api/center/settings", { cookie })).status).toBe(400); // no center selected

    const start = await call("/api/admin/support", { method: "POST", cookie, body: json({ centerId: center.id }) });
    expect(start.status).toBe(200);
    const me = (await (await call("/api/auth/me", { cookie })).json()) as { user: { supportCenterId: string } };
    expect(me.user.supportCenterId).toBe(center.id);

    const upd = await call("/api/center/settings", { method: "PATCH", cookie, body: json({ nameEn: "Renamed by support" }) });
    expect(upd.status).toBe(200);

    const activity = (await (
      await call(`/api/admin/activity?centerId=${center.id}`, { cookie })
    ).json()) as { activity: { action: string; isSupportAction: boolean }[] };
    const update = activity.activity.find((a) => a.action === "update_settings");
    expect(update?.isSupportAction).toBe(true);
    expect(activity.activity.map((a) => a.action)).toContain("support_start");

    await call("/api/admin/support/exit", { method: "POST", body: "{}", cookie });
    expect((await call("/api/center/settings", { cookie })).status).toBe(400);
  });

  it("is not available to center staff", async () => {
    const { cookie } = await managerSession();
    const other = await createCenter();
    expect((await call("/api/admin/support", { method: "POST", cookie, body: json({ centerId: other.id }) })).status).toBe(403);
  });
});
