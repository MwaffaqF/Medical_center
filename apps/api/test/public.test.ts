import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { addDays, todayIn, zonedToUtc } from "@mc/shared";
import { appointments, bookingRequests, centers, patients } from "../src/db/schema";
import { call, db, json, managerSession } from "./helpers";

const TZ = "Asia/Damascus";
const future = (days: number) => addDays(todayIn(TZ), days);

type Site = {
  center: Record<string, unknown> & { slug: string; status: string };
  specialties: { id: string; doctorCount: number }[];
  doctors: { id: string; slug: string; services: { bookingType: string; price: number }[] }[];
};

async function publishedCenter() {
  const { center, cookie } = await managerSession();
  const spec = await call("/api/center/specialties", { method: "POST", cookie, body: json({ nameAr: "جلدية", nameEn: "Dermatology" }) });
  const { specialty } = (await spec.json()) as { specialty: { id: string } };
  const mk = async (nameEn: string, isActive = true) => {
    const res = await call("/api/center/doctors", {
      method: "POST",
      cookie,
      body: json({ nameAr: `د. ${nameEn}`, nameEn, specialtyIds: [specialty.id], isActive }),
    });
    const { doctor } = (await res.json()) as { doctor: { id: string; slug: string } };
    await call(`/api/center/doctors/${doctor.id}/services`, {
      method: "PUT",
      cookie,
      body: json({
        services: [
          { bookingType: "visit", durationMinutes: 20, price: 25000 },
          { bookingType: "revisit", durationMinutes: 10, price: 25000 },
          { bookingType: "session", durationMinutes: 45, price: 60000, isActive: false },
        ],
      }),
    });
    return doctor;
  };
  const doctor = await mk("Dr Sara");
  await mk("Dr Hidden", false);
  const date = future(3);
  await call("/api/center/availability", {
    method: "POST",
    cookie,
    body: json({ doctorId: doctor.id, date, startTime: "16:00", endTime: "17:00" }),
  });
  return { center, cookie, doctor, date, specialtyId: specialty.id };
}

const booking = (doctorId: string, date: string, time: string, extra: Record<string, unknown> = {}) => ({
  doctorId,
  bookingType: "visit",
  startAt: zonedToUtc(date, time, TZ),
  fullName: "Ahmad Al-Khatib",
  phone: "0944 111 222",
  consent: true,
  ...extra,
});

describe("public site data", () => {
  it("returns only public information and active doctors", async () => {
    const { center, specialtyId } = await publishedCenter();
    const res = await call(`/api/public/${center.slug}/site`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("max-age=60");
    const site = (await res.json()) as Site;
    expect(site.center.status).toBe("active");
    expect(site.center).not.toHaveProperty("id");
    expect(site.center).not.toHaveProperty("minLeadMinutes");
    expect(site.doctors.map((d) => d.slug)).toEqual(["dr-sara"]);
    expect(site.doctors[0]!.services.map((s) => s.bookingType)).toEqual(["visit", "revisit"]); // inactive "session" hidden
    expect(site.specialties).toEqual([expect.objectContaining({ id: specialtyId, doctorCount: 1 })]);
    expect(JSON.stringify(site)).not.toMatch(/userId|createdAt|passwordHash/);
  });

  it("returns a doctor profile by slug and 404 for unknown or inactive doctors", async () => {
    const { center } = await publishedCenter();
    expect((await call(`/api/public/${center.slug}/doctors/dr-sara`)).status).toBe(200);
    expect((await call(`/api/public/${center.slug}/doctors/dr-hidden`)).status).toBe(404);
    expect((await call(`/api/public/no-such-center/site`)).status).toBe(404);
  });

  it("marks a suspended center and refuses its bookings", async () => {
    const { center, doctor, date } = await publishedCenter();
    await db().update(centers).set({ status: "suspended" }).where(eq(centers.id, center.id));
    const site = (await (await call(`/api/public/${center.slug}/site`)).json()) as Site;
    expect(site.center.status).toBe("suspended");
    expect(site.doctors).toEqual([]);
    const res = await call(`/api/public/${center.slug}/bookings`, { method: "POST", body: json(booking(doctor.id, date, "16:00")) });
    expect(res.status).toBe(403);
  });
});

describe("public slots", () => {
  it("applies the minimum notice and booking window", async () => {
    const { center, doctor, date } = await publishedCenter();
    const res = await call(`/api/public/${center.slug}/doctors/${doctor.id}/slots?bookingType=visit&from=${future(0)}&days=7`);
    const body = (await res.json()) as { days: { date: string; slots: { time: string; startAt: number }[] }[]; price: number };
    expect(body.price).toBe(25000);
    expect(body.days.find((d) => d.date === date)!.slots.map((s) => s.time)).toEqual(["16:00", "16:10", "16:20", "16:30", "16:40"]);

    // A window beyond max advance days is clipped.
    const far = await call(`/api/public/${center.slug}/doctors/${doctor.id}/slots?bookingType=visit&from=${future(40)}&days=7`);
    expect(((await far.json()) as { days: unknown[] }).days).toEqual([]);
  });
});

describe("online booking", () => {
  it("books a free slot as pending, creating the patient", async () => {
    const { center, doctor, date } = await publishedCenter();
    const res = await call(`/api/public/${center.slug}/bookings`, {
      method: "POST",
      body: json(booking(doctor.id, date, "16:20", { note: "First visit", preferredLocale: "en" })),
    });
    expect(res.status).toBe(201);
    const { booking: b } = (await res.json()) as { booking: { referenceCode: string; status: string; price: number } };
    expect(b).toMatchObject({ status: "pending", price: 25000 });
    expect(b.referenceCode).toMatch(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/);

    const row = await db().query.appointments.findFirst({ where: eq(appointments.referenceCode, b.referenceCode) });
    expect(row).toMatchObject({ status: "pending", source: "website", priceSnapshot: 25000, patientNote: "First visit", createdBy: null });
    const patient = await db().query.patients.findFirst({ where: eq(patients.id, row!.patientId) });
    expect(patient).toMatchObject({ phone: "+963944111222", fullName: "Ahmad Al-Khatib", preferredLocale: "en", source: "website" });

    // The slot is gone from the public list now.
    const slots = (await (
      await call(`/api/public/${center.slug}/doctors/${doctor.id}/slots?bookingType=visit&from=${date}&days=1`)
    ).json()) as { days: { slots: { time: string }[] }[] };
    expect(slots.days[0]!.slots.map((s) => s.time)).toEqual(["16:00", "16:40"]);
  });

  it("refuses taken, invented and non-offered slots", async () => {
    const { center, doctor, date } = await publishedCenter();
    const url = `/api/public/${center.slug}/bookings`;
    expect((await call(url, { method: "POST", body: json(booking(doctor.id, date, "16:00")) })).status).toBe(201);
    const again = await call(url, { method: "POST", body: json(booking(doctor.id, date, "16:10", { phone: "0933000111" })) });
    expect(again.status).toBe(409); // overlaps 16:00–16:20
    expect((await call(url, { method: "POST", body: json(booking(doctor.id, date, "16:05", { phone: "0933000112" })) })).status).toBe(409); // not on the grid
    expect((await call(url, { method: "POST", body: json(booking(doctor.id, future(4), "16:00", { phone: "0933000113" })) })).status).toBe(409); // no session
    const session = await call(url, { method: "POST", body: json(booking(doctor.id, date, "16:20", { phone: "0933000114", bookingType: "session" })) });
    expect(session.status).toBe(404);
  });

  it("validates patient details and requires consent", async () => {
    const { center, doctor, date } = await publishedCenter();
    const res = await call(`/api/public/${center.slug}/bookings`, {
      method: "POST",
      body: json(booking(doctor.id, date, "16:00", { fullName: "A", phone: "123", consent: false })),
    });
    expect(res.status).toBe(400);
    const { error } = (await res.json()) as { error: { fields: Record<string, string> } };
    expect(error.fields).toMatchObject({ fullName: "required", phone: "invalid_phone", consent: "consent_required" });
  });

  it("reuses the same patient for the same phone and name, and keeps family members separate", async () => {
    const { center, doctor, date } = await publishedCenter();
    const url = `/api/public/${center.slug}/bookings`;
    await call(url, { method: "POST", body: json(booking(doctor.id, date, "16:00")) });
    await call(url, { method: "POST", body: json(booking(doctor.id, date, "16:20", { fullName: "ahmad  al-khatib" })) });
    await call(url, { method: "POST", body: json(booking(doctor.id, date, "16:40", { fullName: "Lama Al-Khatib" })) });
    const rows = await db().query.patients.findMany({ where: eq(patients.centerId, center.id) });
    expect(rows.map((p) => p.fullName).sort()).toEqual(["Ahmad Al-Khatib", "Lama Al-Khatib"]);
  });

  it("flags a re-visit without an earlier completed visit", async () => {
    const { center, doctor, date } = await publishedCenter();
    const res = await call(`/api/public/${center.slug}/bookings`, {
      method: "POST",
      body: json(booking(doctor.id, date, "16:00", { bookingType: "revisit", phone: "0966 123 999" })),
    });
    const { booking: b } = (await res.json()) as { booking: { referenceCode: string } };
    const row = await db().query.appointments.findFirst({ where: eq(appointments.referenceCode, b.referenceCode) });
    expect(row).toMatchObject({ bookingType: "revisit", revisitFlag: true, endAt: new Date(zonedToUtc(date, "16:10", TZ)) });
  });

  it("limits bookings per network", async () => {
    const { center, doctor, date } = await publishedCenter();
    const url = `/api/public/${center.slug}/bookings`;
    const headers = { "cf-connecting-ip": "198.51.100.7" };
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      // Invalid times: each attempt still counts toward the limit.
      const res = await call(url, { method: "POST", headers, body: json(booking(doctor.id, date, "16:05", { phone: `09330000${10 + i}` })) });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 409)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it("limits bookings per phone number", async () => {
    const { center, cookie, doctor } = await publishedCenter();
    const date = future(6);
    await call("/api/center/availability", {
      method: "POST",
      cookie,
      body: json({ doctorId: doctor.id, date, startTime: "09:00", endTime: "12:00" }),
    });
    const url = `/api/public/${center.slug}/bookings`;
    const phone = "0955 777 888";
    const statuses: number[] = [];
    for (const time of ["09:00", "09:20", "09:40", "10:00", "10:20", "10:40"]) {
      statuses.push((await call(url, { method: "POST", body: json(booking(doctor.id, date, time, { phone })) })).status);
    }
    expect(statuses).toEqual([201, 201, 201, 201, 201, 429]);
  });
});

describe("booking requests", () => {
  it("creates a request with a reference code", async () => {
    const { center, doctor } = await publishedCenter();
    const res = await call(`/api/public/${center.slug}/requests`, {
      method: "POST",
      body: json({
        doctorId: doctor.id,
        bookingType: "visit",
        preferredDate: future(10),
        preferredPeriod: "evening",
        fullName: "Rana",
        phone: "0988123456",
        consent: true,
      }),
    });
    expect(res.status).toBe(201);
    const { request } = (await res.json()) as { request: { referenceCode: string } };
    const row = await db().query.bookingRequests.findFirst({ where: eq(bookingRequests.referenceCode, request.referenceCode) });
    expect(row).toMatchObject({ status: "new", preferredPeriod: "evening", preferredDate: future(10) });
  });

  it("refuses past preferred dates", async () => {
    const { center, doctor } = await publishedCenter();
    const res = await call(`/api/public/${center.slug}/requests`, {
      method: "POST",
      body: json({ doctorId: doctor.id, bookingType: "visit", preferredDate: future(-2), fullName: "Rana", phone: "0988123457", consent: true }),
    });
    expect(res.status).toBe(400);
  });
});
