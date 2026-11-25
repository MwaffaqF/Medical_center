import { describe, expect, it } from "vitest";
import { addDays, todayIn, weekStart, zonedToUtc } from "@mc/shared";
import { patients } from "../src/db/schema";
import { insertAppointmentIfFree } from "../src/domain/booking";
import { call, createUser, db, json, login, managerSession } from "./helpers";

const TZ = "Asia/Damascus";
const future = (days: number) => addDays(todayIn(TZ), days);

type Session = { id: string; date: string; startTime: string; endTime: string; status: string; bookedCount: number };

async function setup() {
  const { center, cookie } = await managerSession();
  const doc = await call("/api/center/doctors", { method: "POST", cookie, body: json({ nameAr: "د. س", nameEn: "Dr S" }) });
  const { doctor } = (await doc.json()) as { doctor: { id: string } };
  await call(`/api/center/doctors/${doctor.id}/services`, {
    method: "PUT",
    cookie,
    body: json({ services: [{ bookingType: "visit", durationMinutes: 20, price: 100 }] }),
  });
  return { center, cookie, doctorId: doctor.id };
}

async function addSession(cookie: string, doctorId: string, date: string, startTime = "16:00", endTime = "18:00") {
  const res = await call("/api/center/availability", { method: "POST", cookie, body: json({ doctorId, date, startTime, endTime }) });
  return { res, session: res.ok ? ((await res.clone().json()) as { session: Session }).session : null };
}

async function book(centerId: string, doctorId: string, sessionId: string | null, date: string, start: string, end: string, override = false) {
  const [patient] = await db()
    .insert(patients)
    .values({ centerId, fullName: "Patient", phone: "+963944000000", source: "phone" })
    .returning();
  return insertAppointmentIfFree(db(), {
    centerId,
    patientId: patient!.id,
    doctorId,
    bookingType: "visit",
    sessionId,
    startAt: zonedToUtc(date, start, TZ),
    endAt: zonedToUtc(date, end, TZ),
    status: "confirmed",
    source: "phone",
    priceSnapshot: 100,
    isOverride: override,
  });
}

describe("availability sessions", () => {
  it("creates sessions and rejects overlaps, bad times and past dates", async () => {
    const { cookie, doctorId } = await setup();
    const date = future(3);
    expect((await addSession(cookie, doctorId, date)).res.status).toBe(201);
    expect((await addSession(cookie, doctorId, date, "17:30", "19:00")).res.status).toBe(409);
    expect((await addSession(cookie, doctorId, date, "18:00", "20:00")).res.status).toBe(201); // touching is fine
    const bad = await addSession(cookie, doctorId, date, "21:00", "20:00");
    expect(await bad.res.json()).toMatchObject({ error: { fields: { endTime: "end_before_start" } } });
    expect((await addSession(cookie, doctorId, future(-1))).res.status).toBe(400);

    const list = await call(`/api/center/availability?from=${date}&to=${date}&doctorId=${doctorId}`, { cookie });
    const { sessions } = (await list.json()) as { sessions: Session[] };
    expect(sessions.map((s) => s.startTime)).toEqual(["16:00", "18:00"]);
  });

  it("reception can plan; doctors can only read", async () => {
    const { center, cookie, doctorId } = await setup();
    await createUser({ email: `rec-${doctorId.slice(0, 6)}@t.sy`, password: "reception-pw", role: "receptionist", centerId: center.id });
    await createUser({ email: `doc-${doctorId.slice(0, 6)}@t.sy`, password: "doctor-pw-1", role: "doctor", centerId: center.id });
    const rec = (await login(`rec-${doctorId.slice(0, 6)}@t.sy`, "reception-pw")).cookie;
    const doc = (await login(`doc-${doctorId.slice(0, 6)}@t.sy`, "doctor-pw-1")).cookie;
    expect((await addSession(rec, doctorId, future(2))).res.status).toBe(201);
    expect((await addSession(doc, doctorId, future(4))).res.status).toBe(403);
    expect((await call(`/api/center/availability?from=${future(0)}&to=${future(7)}`, { cookie: doc })).status).toBe(200);
    void cookie;
  });

  it("is isolated per center", async () => {
    const a = await setup();
    const b = await managerSession();
    expect((await addSession(b.cookie, a.doctorId, future(2))).res.status).toBe(404);
    const { session } = await addSession(a.cookie, a.doctorId, future(2));
    expect((await call(`/api/center/availability/${session!.id}`, { method: "PATCH", cookie: b.cookie, body: json({ status: "closed" }) })).status).toBe(404);
  });

  it("warns before closing or shrinking a session with bookings, then applies when confirmed", async () => {
    const { center, cookie, doctorId } = await setup();
    const date = future(5);
    const { session } = await addSession(cookie, doctorId, date);
    expect((await book(center.id, doctorId, session!.id, date, "17:30", "17:50")).ok).toBe(true);

    // Shrinking to 16:00–17:00 leaves the 17:30 booking outside.
    const shrink = await call(`/api/center/availability/${session!.id}`, { method: "PATCH", cookie, body: json({ endTime: "17:00" }) });
    expect(shrink.status).toBe(409);
    const body = (await shrink.json()) as { affected: { patientName: string; referenceCode: string }[] };
    expect(body.affected).toHaveLength(1);
    expect(body.affected[0]!.patientName).toBe("Patient");

    // Shrinking that keeps the booking inside needs no confirmation.
    const ok = await call(`/api/center/availability/${session!.id}`, { method: "PATCH", cookie, body: json({ startTime: "17:00" }) });
    expect(ok.status).toBe(200);

    const close = await call(`/api/center/availability/${session!.id}`, { method: "PATCH", cookie, body: json({ status: "closed" }) });
    expect(close.status).toBe(409);
    const confirmed = await call(`/api/center/availability/${session!.id}`, {
      method: "PATCH",
      cookie,
      body: json({ status: "closed", confirm: true }),
    });
    expect(confirmed.status).toBe(200);
    expect(await confirmed.json()).toMatchObject({ session: { status: "closed" }, affected: [{ referenceCode: expect.any(String) }] });

    const del = await call(`/api/center/availability/${session!.id}`, { method: "DELETE", cookie, headers: { "content-type": "application/json" } });
    expect(del.status).toBe(409);
    const delOk = await call(`/api/center/availability/${session!.id}?confirm=1`, {
      method: "DELETE",
      cookie,
      headers: { "content-type": "application/json" },
    });
    expect(delOk.status).toBe(200);
  });

  it("copies a week: preview first, then create, skipping clashes", async () => {
    const { cookie, doctorId } = await setup();
    const thisWeek = weekStart(future(7));
    const nextWeek = addDays(thisWeek, 7);
    await addSession(cookie, doctorId, thisWeek, "09:00", "12:00");
    await addSession(cookie, doctorId, addDays(thisWeek, 2), "16:00", "20:00");
    await addSession(cookie, doctorId, addDays(nextWeek, 2), "19:00", "21:00"); // clashes with the copy

    const preview = await call("/api/center/availability/copy-week", {
      method: "POST",
      cookie,
      body: json({ fromWeek: thisWeek, toWeek: nextWeek, doctorId }),
    });
    const p = (await preview.json()) as { dryRun: boolean; planned: { date: string }[]; skipped: { reason: string }[] };
    expect(p.dryRun).toBe(true);
    expect(p.planned.map((x) => x.date)).toEqual([nextWeek]);
    expect(p.skipped.map((x) => x.reason)).toEqual(["session_overlaps"]);

    let list = (await (await call(`/api/center/availability?from=${nextWeek}&to=${addDays(nextWeek, 6)}`, { cookie })).json()) as { sessions: Session[] };
    expect(list.sessions).toHaveLength(1); // preview saved nothing

    await call("/api/center/availability/copy-week", {
      method: "POST",
      cookie,
      body: json({ fromWeek: thisWeek, toWeek: nextWeek, doctorId, dryRun: false }),
    });
    list = (await (await call(`/api/center/availability?from=${nextWeek}&to=${addDays(nextWeek, 6)}`, { cookie })).json()) as { sessions: Session[] };
    expect(list.sessions.map((s) => `${s.date} ${s.startTime}`)).toEqual([`${nextWeek} 09:00`, `${addDays(nextWeek, 2)} 19:00`]);
  });
});

describe("slots for reception", () => {
  it("lists free slots and hides booked ones", async () => {
    const { center, cookie, doctorId } = await setup();
    const date = future(2);
    const { session } = await addSession(cookie, doctorId, date, "16:00", "17:00");
    await book(center.id, doctorId, session!.id, date, "16:20", "16:40");

    const res = await call(`/api/center/availability/slots/${doctorId}?bookingType=visit&from=${date}&days=1`, { cookie });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { durationMinutes: number; price: number; days: { date: string; slots: { time: string }[] }[] };
    expect(body).toMatchObject({ durationMinutes: 20, price: 100 });
    expect(body.days[0]!.slots.map((s) => s.time)).toEqual(["16:00", "16:40"]);

    const none = await call(`/api/center/availability/slots/${doctorId}?bookingType=session&from=${date}`, { cookie });
    expect(none.status).toBe(404);
  });
});

describe("double-booking protection", () => {
  it("lets exactly one of two simultaneous bookings for the same time succeed", async () => {
    const { center, cookie, doctorId } = await setup();
    const date = future(3);
    const { session } = await addSession(cookie, doctorId, date);
    const results = await Promise.all([
      book(center.id, doctorId, session!.id, date, "16:00", "16:20"),
      book(center.id, doctorId, session!.id, date, "16:10", "16:30"),
      book(center.id, doctorId, session!.id, date, "16:00", "16:20"),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok).every((r) => !r.ok && r.reason === "slot_taken")).toBe(true);
  });

  it("refuses closed sessions unless it is a reception override", async () => {
    const { center, cookie, doctorId } = await setup();
    const date = future(3);
    const { session } = await addSession(cookie, doctorId, date);
    await call(`/api/center/availability/${session!.id}`, { method: "PATCH", cookie, body: json({ status: "closed" }) });
    expect((await book(center.id, doctorId, session!.id, date, "16:00", "16:20")).ok).toBe(false);
    expect((await book(center.id, doctorId, null, date, "16:00", "16:20")).ok).toBe(false);
    expect((await book(center.id, doctorId, null, date, "16:00", "16:20", true)).ok).toBe(true);
  });

  it("cancelled appointments free the time again", async () => {
    const { center, cookie, doctorId } = await setup();
    const date = future(3);
    const { session } = await addSession(cookie, doctorId, date);
    const first = await book(center.id, doctorId, session!.id, date, "16:00", "16:20");
    const { appointments } = await import("../src/db/schema");
    const { eq } = await import("drizzle-orm");
    await db().update(appointments).set({ status: "cancelled" }).where(eq(appointments.id, first.ok ? first.id : ""));
    expect((await book(center.id, doctorId, session!.id, date, "16:00", "16:20")).ok).toBe(true);
  });
});
