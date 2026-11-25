import { describe, expect, it } from "vitest";
import { addDays, todayIn, zonedToUtc } from "@mc/shared";
import { call, createUser, json, login, managerSession } from "./helpers";

const TZ = "Asia/Damascus";
const future = (days: number) => addDays(todayIn(TZ), days);
const at = (date: string, time: string) => zonedToUtc(date, time, TZ);

type Appt = {
  id: string;
  status: string;
  startAt: string;
  endAt: string;
  bookingType: string;
  priceSnapshot: number;
  revisitFlag: boolean;
  isOverride: boolean;
  referenceCode: string;
  patient: { id: string; fullName: string; phone: string };
};

async function setup() {
  const { center, cookie: manager } = await managerSession();
  const email = `rec-${crypto.randomUUID().slice(0, 6)}@t.sy`;
  await createUser({ email, password: "reception-pw", role: "receptionist", centerId: center.id });
  const cookie = (await login(email, "reception-pw")).cookie;
  await call("/api/center/settings", {
    method: "PATCH",
    cookie: manager,
    body: json({ nameAr: "مركز الشفاء", nameEn: "Al-Shifa Center", mapUrl: "https://maps.example/x", whatsappPhone: "0944000111" }),
  });
  const { doctor } = (await (
    await call("/api/center/doctors", { method: "POST", cookie: manager, body: json({ nameAr: "د. سارة", nameEn: "Dr Sara" }) })
  ).json()) as { doctor: { id: string } };
  await call(`/api/center/doctors/${doctor.id}/services`, {
    method: "PUT",
    cookie: manager,
    body: json({
      services: [
        { bookingType: "visit", durationMinutes: 20, price: 25000 },
        { bookingType: "revisit", durationMinutes: 10, price: 20000 },
      ],
    }),
  });
  const date = future(2);
  await call("/api/center/availability", { method: "POST", cookie, body: json({ doctorId: doctor.id, date, startTime: "16:00", endTime: "18:00" }) });
  return { center, manager, cookie, doctorId: doctor.id, date };
}

async function book(cookie: string, body: Record<string, unknown>) {
  const res = await call("/api/center/appointments", { method: "POST", cookie, body: json(body) });
  return { res, appt: res.ok ? ((await res.clone().json()) as { appointment: Appt }).appointment : null };
}

const newPatient = (name = "Ahmad Khatib", phone = "0944 111 222") => ({ fullName: name, phone, preferredLocale: "ar" });

describe("reception bookings", () => {
  it("books a phone appointment for a new patient as confirmed", async () => {
    const { cookie, doctorId, date } = await setup();
    const { res, appt } = await book(cookie, {
      newPatient: newPatient(),
      doctorId,
      bookingType: "visit",
      startAt: at(date, "16:00"),
      source: "phone",
    });
    expect(res.status).toBe(201);
    expect(appt).toMatchObject({ status: "confirmed", priceSnapshot: 25000, patient: { phone: "+963944111222" } });
    expect(new Date(appt!.endAt).getTime() - new Date(appt!.startAt).getTime()).toBe(20 * 60_000);
  });

  it("refuses taken times and times outside a session, unless overridden", async () => {
    const { cookie, doctorId, date } = await setup();
    await book(cookie, { newPatient: newPatient(), doctorId, bookingType: "visit", startAt: at(date, "16:00"), source: "phone" });
    const clash = await book(cookie, { newPatient: newPatient("B Person", "0933000001"), doctorId, bookingType: "visit", startAt: at(date, "16:10"), source: "phone" });
    expect(await clash.res.json()).toEqual({ error: { code: "slot_taken" } });
    const outside = await book(cookie, { newPatient: newPatient("C Person", "0933000002"), doctorId, bookingType: "visit", startAt: at(date, "19:00"), source: "phone" });
    expect(await outside.res.json()).toEqual({ error: { code: "outside_session" } });
    const walkIn = await book(cookie, {
      newPatient: newPatient("D Person", "0933000003"),
      doctorId,
      bookingType: "visit",
      startAt: at(date, "16:05"),
      source: "walk_in",
      status: "checked_in",
      override: true,
    });
    expect(walkIn.res.status).toBe(201);
    expect(walkIn.appt).toMatchObject({ status: "checked_in", isOverride: true });
  });

  it("flags a re-visit without a completed visit, and not after one", async () => {
    const { cookie, doctorId, date } = await setup();
    const first = await book(cookie, { newPatient: newPatient(), doctorId, bookingType: "revisit", startAt: at(date, "16:00"), source: "phone" });
    expect(first.appt!.revisitFlag).toBe(true);
    await call(`/api/center/appointments/${first.appt!.id}/status`, { method: "POST", cookie, body: json({ action: "complete" }) });
    const second = await book(cookie, { patientId: first.appt!.patient.id, doctorId, bookingType: "revisit", startAt: at(date, "17:00"), source: "whatsapp" });
    expect(second.appt!.revisitFlag).toBe(false);
  });

  it("doctors cannot book", async () => {
    const { center, doctorId, date } = await setup();
    await createUser({ email: `d-${doctorId.slice(0, 6)}@t.sy`, password: "doctor-pw-1", role: "doctor", centerId: center.id });
    const doc = (await login(`d-${doctorId.slice(0, 6)}@t.sy`, "doctor-pw-1")).cookie;
    expect((await book(doc, { newPatient: newPatient(), doctorId, bookingType: "visit", startAt: at(date, "16:00"), source: "phone" })).res.status).toBe(403);
  });
});

describe("status changes", () => {
  it("follows the lifecycle and records who did what", async () => {
    const { cookie, doctorId, date } = await setup();
    const { appt } = await book(cookie, { newPatient: newPatient(), doctorId, bookingType: "visit", startAt: at(date, "16:00"), source: "phone" });
    const act = (action: string, reason?: string) =>
      call(`/api/center/appointments/${appt!.id}/status`, { method: "POST", cookie, body: json({ action, reason }) });

    expect((await act("confirm")).status).toBe(409); // already confirmed
    expect((await act("check_in")).status).toBe(200);
    expect((await act("no_show")).status).toBe(409); // can't be a no-show after arriving
    const cancelNoReason = await act("cancel");
    expect(await cancelNoReason.json()).toMatchObject({ error: { fields: { reason: "reason_required" } } });
    expect((await act("complete")).status).toBe(200);
    expect((await act("cancel", "x")).status).toBe(409);

    const detail = (await (await call(`/api/center/appointments/${appt!.id}`, { cookie })).json()) as { history: { action: string; userName: string }[] };
    expect(detail.history.map((h) => h.action)).toEqual(["complete", "check_in", "create"]);
  });

  it("cancelled appointments free the time; reopening checks it is still free", async () => {
    const { cookie, doctorId, date } = await setup();
    const a = await book(cookie, { newPatient: newPatient(), doctorId, bookingType: "visit", startAt: at(date, "16:00"), source: "phone" });
    await call(`/api/center/appointments/${a.appt!.id}/status`, { method: "POST", cookie, body: json({ action: "cancel", reason: "Patient asked" }) });
    const b = await book(cookie, { newPatient: newPatient("Other", "0933999888"), doctorId, bookingType: "visit", startAt: at(date, "16:00"), source: "phone" });
    expect(b.res.status).toBe(201);
    const reopen = await call(`/api/center/appointments/${a.appt!.id}/status`, { method: "POST", cookie, body: json({ action: "reopen" }) });
    expect(await reopen.json()).toEqual({ error: { code: "slot_taken" } });
  });
});

describe("reschedule", () => {
  it("moves an appointment, keeps its price, and refuses taken times", async () => {
    const { cookie, doctorId, date } = await setup();
    const a = await book(cookie, { newPatient: newPatient(), doctorId, bookingType: "visit", startAt: at(date, "16:00"), source: "phone" });
    await book(cookie, { newPatient: newPatient("Other", "0933999888"), doctorId, bookingType: "visit", startAt: at(date, "17:00"), source: "phone" });
    const move = (startAt: number, extra: Record<string, unknown> = {}) =>
      call(`/api/center/appointments/${a.appt!.id}/reschedule`, { method: "POST", cookie, body: json({ startAt, ...extra }) });

    expect(await (await move(at(date, "17:10"))).json()).toEqual({ error: { code: "slot_taken" } });
    // Overlapping only itself is fine.
    const ok = await move(at(date, "16:10"));
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { appointment: Appt }).appointment.startAt).toBe(new Date(at(date, "16:10")).toISOString());

    const typeChange = await move(at(date, "16:30"), { bookingType: "revisit" });
    expect(((await typeChange.json()) as { appointment: Appt }).appointment).toMatchObject({ bookingType: "revisit", priceSnapshot: 20000, revisitFlag: true });
  });
});

describe("WhatsApp messages", () => {
  it("renders the confirmation in the patient's language and logs it", async () => {
    const { cookie, doctorId, date } = await setup();
    const a = await book(cookie, { newPatient: { ...newPatient(), preferredLocale: "en" }, doctorId, bookingType: "visit", startAt: at(date, "16:00"), source: "phone" });
    const res = await call(`/api/center/appointments/${a.appt!.id}/messages`, { method: "POST", cookie, body: json({ templateKey: "confirmation" }) });
    const msg = (await res.json()) as { text: string; url: string; locale: string };
    expect(msg.locale).toBe("en");
    expect(msg.text).toContain("Hello Ahmad Khatib, your Visit with Dr Sara is confirmed");
    expect(msg.text).toContain("16:00");
    expect(msg.text).toContain("25,000 SYP");
    expect(msg.text).toContain(a.appt!.referenceCode);
    expect(msg.text).toContain("https://maps.example/x — Al-Shifa Center");
    expect(msg.url.startsWith("https://wa.me/963944111222?text=")).toBe(true);

    const detail = (await (await call(`/api/center/appointments/${a.appt!.id}`, { cookie })).json()) as { messages: { templateKey: string }[] };
    expect(detail.messages.map((m) => m.templateKey)).toEqual(["confirmation"]);
  });

  it("uses Arabic for Arabic-speaking patients", async () => {
    const { cookie, doctorId, date } = await setup();
    const a = await book(cookie, { newPatient: newPatient(), doctorId, bookingType: "visit", startAt: at(date, "16:00"), source: "phone" });
    const msg = (await (
      await call(`/api/center/appointments/${a.appt!.id}/messages`, { method: "POST", cookie, body: json({ templateKey: "reminder" }) })
    ).json()) as { text: string };
    expect(msg.text).toContain("تذكير: موعدك مع د. سارة");
    expect(msg.text).toContain("مركز الشفاء");
  });
});

describe("today screen", () => {
  it("lists pending online bookings, today's agenda, tomorrow's reminders and new requests", async () => {
    const { center, cookie, doctorId } = await setup();
    const today = future(0);
    const tomorrow = future(1);
    await call("/api/center/availability", { method: "POST", cookie, body: json({ doctorId, date: tomorrow, startTime: "09:00", endTime: "12:00" }) });
    const t1 = await book(cookie, { newPatient: newPatient(), doctorId, bookingType: "visit", startAt: at(tomorrow, "09:00"), source: "phone" });
    // An online (pending) booking and a request
    const site = `/api/public/${center.slug}`;
    const pub = await call(`${site}/bookings`, {
      method: "POST",
      body: json({ doctorId, bookingType: "visit", startAt: at(tomorrow, "10:00"), fullName: "Online Patient", phone: "0955123123", consent: true }),
    });
    expect(pub.status).toBe(201);
    await call(`${site}/requests`, { method: "POST", body: json({ doctorId, bookingType: "visit", fullName: "Req Patient", phone: "0955123124", consent: true }) });
    await call(`/api/center/appointments/${t1.appt!.id}/messages`, { method: "POST", cookie, body: json({ templateKey: "reminder" }) });

    const res = (await (await call("/api/center/appointments/today", { cookie })).json()) as {
      date: string;
      pending: Appt[];
      agenda: Appt[];
      tomorrow: (Appt & { reminderSent: boolean })[];
      newRequests: number;
    };
    expect(res.date).toBe(today);
    expect(res.pending.map((p) => p.patient.fullName)).toEqual(["Online Patient"]);
    expect(res.tomorrow.map((t) => [t.patient.fullName, t.reminderSent])).toEqual([
      ["Ahmad Khatib", true],
      ["Online Patient", false],
    ]);
    expect(res.newRequests).toBe(1);
  });
});

describe("booking requests", () => {
  it("follows up on WhatsApp, then converts the request into an appointment", async () => {
    const { center, cookie, doctorId, date } = await setup();
    await call(`/api/public/${center.slug}/requests`, {
      method: "POST",
      body: json({ doctorId, bookingType: "visit", preferredPeriod: "evening", fullName: "Rana", phone: "0988123456", consent: true }),
    });
    const list = (await (await call("/api/center/requests?status=new", { cookie })).json()) as {
      requests: { id: string; patient: { id: string }; referenceCode: string }[];
    };
    const r = list.requests[0]!;
    const msg = (await (await call(`/api/center/requests/${r.id}/messages`, { method: "POST", cookie, body: "{}" })).json()) as { text: string };
    expect(msg.text).toContain("Rana");
    const contacted = (await (await call("/api/center/requests?status=contacted", { cookie })).json()) as { requests: unknown[] };
    expect(contacted.requests).toHaveLength(1);

    const conv = await book(cookie, { patientId: r.patient.id, doctorId, bookingType: "visit", startAt: at(date, "17:00"), source: "whatsapp", requestId: r.id });
    expect(conv.res.status).toBe(201);
    const converted = (await (await call("/api/center/requests?status=converted", { cookie })).json()) as { requests: { appointmentId: string }[] };
    expect(converted.requests[0]!.appointmentId).toBe(conv.appt!.id);
    // A converted request can't be converted again.
    const again = await book(cookie, { patientId: r.patient.id, doctorId, bookingType: "visit", startAt: at(date, "17:30"), source: "whatsapp", requestId: r.id });
    expect(await again.res.json()).toEqual({ error: { code: "request_not_open" } });
  });
});

describe("patients", () => {
  it("searches by name or phone, shows history, edits, and merges duplicates", async () => {
    const { manager, cookie, doctorId, date } = await setup();
    const a = await book(cookie, { newPatient: newPatient("Ahmad Khatib", "0944 111 222"), doctorId, bookingType: "visit", startAt: at(date, "16:00"), source: "phone" });
    const dup = await book(cookie, { newPatient: newPatient("Ahmed Al-Khatib", "0944 111 222"), doctorId, bookingType: "visit", startAt: at(date, "16:30"), source: "phone" });

    const byPhone = (await (await call("/api/center/patients?q=0944111", { cookie })).json()) as { patients: { id: string; total: number }[] };
    expect(byPhone.patients).toHaveLength(2);
    expect(byPhone.patients.map((p) => p.total)).toEqual([1, 1]);
    const byName = (await (await call(`/api/center/patients?q=${encodeURIComponent("ahmad")}`, { cookie })).json()) as { patients: unknown[] };
    expect(byName.patients).toHaveLength(1);

    const edit = await call(`/api/center/patients/${a.appt!.patient.id}`, { method: "PATCH", cookie, body: json({ notes: "Prefers evenings" }) });
    expect(edit.status).toBe(200);

    // Merging is for managers only.
    const recMerge = await call(`/api/center/patients/${dup.appt!.patient.id}/merge`, { method: "POST", cookie, body: json({ intoId: a.appt!.patient.id }) });
    expect(recMerge.status).toBe(403);
    const merge = await call(`/api/center/patients/${dup.appt!.patient.id}/merge`, { method: "POST", cookie: manager, body: json({ intoId: a.appt!.patient.id }) });
    expect(merge.status).toBe(200);
    const profile = (await (await call(`/api/center/patients/${a.appt!.patient.id}`, { cookie })).json()) as {
      patient: { total: number; notes: string };
      appointments: unknown[];
    };
    expect(profile.patient).toMatchObject({ total: 2, notes: "Prefers evenings" });
    expect((await call(`/api/center/patients/${dup.appt!.patient.id}`, { cookie })).status).toBe(404);
  });

  it("refuses to create an exact duplicate", async () => {
    const { cookie } = await setup();
    expect((await call("/api/center/patients", { method: "POST", cookie, body: json(newPatient()) })).status).toBe(201);
    const again = await call("/api/center/patients", { method: "POST", cookie, body: json(newPatient("ahmad khatib")) });
    expect(again.status).toBe(409);
  });
});
