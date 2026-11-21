import { describe, expect, it } from "vitest";
import { call, createCenter, createUser, json, login, managerSession } from "./helpers";

type Doctor = {
  id: string;
  slug: string;
  photoUrl: string | null;
  specialtyIds: string[];
  primarySpecialtyId: string | null;
  services: { bookingType: string; durationMinutes: number; price: number; isActive: boolean }[];
};

async function receptionist(centerId: string) {
  const email = `rec-${crypto.randomUUID().slice(0, 6)}@test.sy`;
  await createUser({ email, password: "reception-pw", role: "receptionist", centerId });
  return (await login(email, "reception-pw")).cookie;
}

async function newSpecialty(cookie: string, nameEn: string, nameAr = "اختصاص") {
  const res = await call("/api/center/specialties", { method: "POST", cookie, body: json({ nameAr, nameEn }) });
  return ((await res.json()) as { specialty: { id: string; slug: string } }).specialty;
}

describe("center settings", () => {
  it("manager updates settings; receptionist can read but not change", async () => {
    const { center, cookie } = await managerSession();
    const res = await call("/api/center/settings", {
      method: "PATCH",
      cookie,
      body: json({ whatsappPhone: "0933 111 222", slotStepMinutes: 15, mapUrl: "https://maps.google.com/?q=damascus", aboutAr: "  " }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ center: { whatsappPhone: "+963933111222", slotStepMinutes: 15, aboutAr: null } });

    const bad = await call("/api/center/settings", { method: "PATCH", cookie, body: json({ slotStepMinutes: 7, mapUrl: "javascript:alert(1)" }) });
    expect(bad.status).toBe(400);

    const rec = await receptionist(center.id);
    expect((await call("/api/center/settings", { cookie: rec })).status).toBe(200);
    expect((await call("/api/center/settings", { method: "PATCH", cookie: rec, body: json({ nameEn: "x" }) })).status).toBe(403);
  });

  it("edits WhatsApp templates", async () => {
    const { cookie } = await managerSession();
    const res = await call("/api/center/templates", {
      method: "PUT",
      cookie,
      body: json({ templates: [{ key: "reminder", bodyAr: "تذكير {patient_name}", bodyEn: "Reminder {patient_name}" }] }),
    });
    expect(res.status).toBe(200);
    const { templates } = (await res.json()) as { templates: { key: string; bodyEn: string }[] };
    expect(templates.find((t) => t.key === "reminder")?.bodyEn).toBe("Reminder {patient_name}");
  });
});

describe("center staff management", () => {
  it("manager creates and deactivates staff of their own center only", async () => {
    const { cookie } = await managerSession();
    const created = await call("/api/center/users", {
      method: "POST",
      cookie,
      body: json({ name: "Lina", email: "lina@test.sy", role: "receptionist" }),
    });
    expect(created.status).toBe(201);
    const { user } = (await created.json()) as { user: { id: string } };
    expect((await call(`/api/center/users/${user.id}`, { method: "PATCH", cookie, body: json({ isActive: false }) })).status).toBe(200);

    const other = await createCenter();
    const outsider = await createUser({ email: "out@test.sy", password: "outsider-pw", role: "receptionist", centerId: other.id });
    expect((await call(`/api/center/users/${outsider.id}`, { method: "PATCH", cookie, body: json({ isActive: false }) })).status).toBe(404);
  });

  it("manager cannot lock themselves out", async () => {
    const { cookie } = await managerSession();
    const me = (await (await call("/api/auth/me", { cookie })).json()) as { user: { id: string } };
    const res = await call(`/api/center/users/${me.user.id}`, { method: "PATCH", cookie, body: json({ isActive: false }) });
    expect(await res.json()).toEqual({ error: { code: "cannot_change_own_access" } });
  });

  it("receptionists cannot manage staff", async () => {
    const center = await createCenter();
    const rec = await receptionist(center.id);
    expect((await call("/api/center/users", { cookie: rec })).status).toBe(403);
  });
});

describe("specialties", () => {
  it("creates with an automatic unique slug and updates", async () => {
    const { cookie } = await managerSession();
    const a = await newSpecialty(cookie, "Dermatology", "جلدية");
    const b = await newSpecialty(cookie, "Dermatology", "جلدية ٢");
    expect(a.slug).toBe("dermatology");
    expect(b.slug).toBe("dermatology-2");
    const upd = await call(`/api/center/specialties/${b.id}`, { method: "PATCH", cookie, body: json({ slug: "dermatology", isActive: false }) });
    expect(upd.status).toBe(409);
    const ok = await call(`/api/center/specialties/${b.id}`, { method: "PATCH", cookie, body: json({ isActive: false }) });
    expect(await ok.json()).toMatchObject({ specialty: { isActive: false } });
  });

  it("are isolated per center", async () => {
    const one = await managerSession();
    const two = await managerSession();
    const s = await newSpecialty(one.cookie, "Pediatrics");
    const list = (await (await call("/api/center/specialties", { cookie: two.cookie })).json()) as { specialties: unknown[] };
    expect(list.specialties).toHaveLength(0);
    expect((await call(`/api/center/specialties/${s.id}`, { method: "PATCH", cookie: two.cookie, body: json({ nameEn: "x" }) })).status).toBe(404);
  });
});

describe("doctors", () => {
  it("creates a doctor with specialties and booking types", async () => {
    const { cookie } = await managerSession();
    const derm = await newSpecialty(cookie, "Dermatology");
    const cosm = await newSpecialty(cookie, "Cosmetics");

    const res = await call("/api/center/doctors", {
      method: "POST",
      cookie,
      body: json({
        nameAr: "د. سارة الحموي",
        nameEn: "Dr. Sara Al-Hamwi",
        titleEn: "Consultant Dermatologist",
        gender: "female",
        languages: ["ar", "en"],
        specialtyIds: [derm.id, cosm.id],
        primarySpecialtyId: derm.id,
      }),
    });
    expect(res.status).toBe(201);
    const { doctor } = (await res.json()) as { doctor: Doctor };
    expect(doctor).toMatchObject({ slug: "dr-sara-al-hamwi", primarySpecialtyId: derm.id });
    expect(doctor.specialtyIds.sort()).toEqual([derm.id, cosm.id].sort());

    const svc = await call(`/api/center/doctors/${doctor.id}/services`, {
      method: "PUT",
      cookie,
      body: json({
        services: [
          { bookingType: "session", durationMinutes: 45, price: 300 },
          { bookingType: "visit", durationMinutes: 20, price: 150 },
          { bookingType: "revisit", durationMinutes: 10, price: 150 },
        ],
      }),
    });
    expect(svc.status).toBe(200);
    const withServices = ((await svc.json()) as { doctor: Doctor }).doctor;
    expect(withServices.services.map((s) => s.bookingType)).toEqual(["visit", "revisit", "session"]);

    // Replacing with fewer types removes the others; updating keeps one row per type.
    const svc2 = await call(`/api/center/doctors/${doctor.id}/services`, {
      method: "PUT",
      cookie,
      body: json({ services: [{ bookingType: "visit", durationMinutes: 30, price: 200 }] }),
    });
    const after = ((await svc2.json()) as { doctor: Doctor }).doctor.services;
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ bookingType: "visit", durationMinutes: 30, price: 200 });
  });

  it("rejects duplicate booking types and other centers' specialties", async () => {
    const { cookie } = await managerSession();
    const other = await managerSession();
    const foreign = await newSpecialty(other.cookie, "Cardiology");
    const bad = await call("/api/center/doctors", {
      method: "POST",
      cookie,
      body: json({ nameAr: "د. أ", nameEn: "Dr A", specialtyIds: [foreign.id] }),
    });
    expect(await bad.json()).toEqual({ error: { code: "unknown_specialty" } });

    const doc = await call("/api/center/doctors", { method: "POST", cookie, body: json({ nameAr: "د. ب", nameEn: "Dr B" }) });
    const { doctor } = (await doc.json()) as { doctor: Doctor };
    const dup = await call(`/api/center/doctors/${doctor.id}/services`, {
      method: "PUT",
      cookie,
      body: json({
        services: [
          { bookingType: "visit", durationMinutes: 20, price: 1 },
          { bookingType: "visit", durationMinutes: 30, price: 1 },
        ],
      }),
    });
    expect(dup.status).toBe(400);
  });

  it("uploads, serves and replaces a photo; rejects non-images", async () => {
    const { cookie } = await managerSession();
    const { doctor } = (await (
      await call("/api/center/doctors", { method: "POST", cookie, body: json({ nameAr: "د. ج", nameEn: "Dr C" }) })
    ).json()) as { doctor: Doctor };

    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
    const up = await call(`/api/center/doctors/${doctor.id}/photo`, {
      method: "PUT",
      cookie,
      body: png,
      headers: { "content-type": "image/png" },
    });
    expect(up.status).toBe(200);
    const { photoUrl } = (await up.json()) as { photoUrl: string };
    expect(photoUrl).toMatch(/^\/api\/media\/c\/.+\.png$/);

    const served = await call(photoUrl);
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/png");
    expect(served.headers.get("cache-control")).toContain("immutable");
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(png);

    const fake = await call(`/api/center/doctors/${doctor.id}/photo`, {
      method: "PUT",
      cookie,
      body: "<svg onload=alert(1)>",
      headers: { "content-type": "image/png" },
    });
    expect(fake.status).toBe(415);

    const svg = await call(`/api/center/doctors/${doctor.id}/photo`, {
      method: "PUT",
      cookie,
      body: "<svg/>",
      headers: { "content-type": "image/svg+xml" },
    });
    expect(svg.status).toBe(415);

    await call(`/api/center/doctors/${doctor.id}/photo`, { method: "DELETE", cookie, headers: { "content-type": "application/json" } });
    expect((await call(photoUrl)).status).toBe(404);
  });

  it("receptionist can list doctors but not edit them", async () => {
    const { center, cookie } = await managerSession();
    await call("/api/center/doctors", { method: "POST", cookie, body: json({ nameAr: "د. د", nameEn: "Dr D" }) });
    const rec = await receptionist(center.id);
    const list = (await (await call("/api/center/doctors", { cookie: rec })).json()) as { doctors: unknown[] };
    expect(list.doctors).toHaveLength(1);
    expect((await call("/api/center/doctors", { method: "POST", cookie: rec, body: json({ nameAr: "x", nameEn: "x" }) })).status).toBe(403);
  });
});
