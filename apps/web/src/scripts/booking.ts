/**
 * Booking page behaviour (spec §10). Plain TypeScript, no framework: small and fast on phones.
 * The page works step by step: appointment type → day → time → details → confirmation.
 */

type Config = {
  locale: "ar" | "en";
  doctorId: string;
  doctorName: string;
  currency: string;
  timeZone: string;
  today: string;
  maxAdvanceDays: number;
  turnstileSiteKey: string | null;
  whatsapp: string | null;
  messages: Record<string, string>;
  services: { bookingType: string; durationMinutes: number; price: number }[];
};
type Day = { date: string; slots: { time: string; startAt: number }[] };
type ApiError = { error?: { code?: string; fields?: Record<string, string> } };

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      reset: (id?: string) => void;
    };
  }
}

export function initBooking(root: HTMLElement) {
  const cfg = JSON.parse(root.dataset.config!) as Config;
  const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const msg = (key: string, vars: Record<string, string | number> = {}) =>
    (cfg.messages[key] ?? key).replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
  const tag = cfg.locale === "ar" ? "ar-SY-u-nu-latn" : "en-GB";
  const noonUtc = (date: string) => new Date(`${date}T12:00:00Z`);
  const fmt = {
    weekday: new Intl.DateTimeFormat(tag, { weekday: "short", timeZone: "UTC" }),
    dayMonth: new Intl.DateTimeFormat(tag, { day: "numeric", month: "short", timeZone: "UTC" }),
    longDate: new Intl.DateTimeFormat(tag, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }),
    time: new Intl.DateTimeFormat(tag, { hour: "numeric", minute: "2-digit", timeZone: cfg.timeZone }),
    number: new Intl.NumberFormat(tag),
  };
  const price = (n: number) => `${fmt.number.format(n)} ${cfg.currency === "SYP" ? msg("currency.SYP") : cfg.currency}`;

  const state = {
    bookingType: (root.querySelector<HTMLInputElement>('input[name="bookingType"]:checked')?.value ?? cfg.services[0]!.bookingType) as string,
    days: [] as Day[],
    date: null as string | null,
    slot: null as { time: string; startAt: number } | null,
    loadSeq: 0,
  };

  const flow = $("#flow");
  const datesEl = $("#dates");
  const datesStatus = $("#dates-status");
  const timeStep = $("#time-step");
  const timesEl = $("#times");
  const details = $<HTMLFormElement>("#details");
  const request = $<HTMLFormElement>("#request");
  const done = $("#done");
  const slotAlert = $("#slot-alert");

  // ------------------------------------------------------------ slots
  async function loadSlots() {
    const seq = ++state.loadSeq;
    state.date = null;
    state.slot = null;
    datesEl.replaceChildren();
    timeStep.hidden = true;
    details.hidden = true;
    datesStatus.hidden = false;
    datesStatus.textContent = msg("book.loading");
    const days = Math.min(31, cfg.maxAdvanceDays + 1);
    try {
      const res = await fetch(`/api/public/doctors/${cfg.doctorId}/slots?bookingType=${state.bookingType}&from=${cfg.today}&days=${days}`);
      if (seq !== state.loadSeq) return;
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { days: Day[] };
      state.days = body.days.filter((d) => d.slots.length);
      renderDates();
    } catch {
      if (seq !== state.loadSeq) return;
      datesStatus.textContent = msg("book.error.network");
    }
  }

  function renderDates() {
    if (!state.days.length) {
      datesStatus.textContent = msg("book.noTimes");
      return;
    }
    datesStatus.hidden = true;
    datesEl.replaceChildren(
      ...state.days.map((d) => {
        const b = document.createElement("button");
        b.type = "button";
        b.dataset.date = d.date;
        b.className =
          "flex min-w-20 shrink-0 snap-start flex-col items-center rounded-2xl px-3 py-3 ring-1 ring-slate-200 transition aria-pressed:bg-brand-700 aria-pressed:text-white aria-pressed:ring-brand-700";
        b.setAttribute("aria-pressed", "false");
        const wd = document.createElement("span");
        wd.className = "text-xs font-medium opacity-80";
        wd.textContent = fmt.weekday.format(noonUtc(d.date));
        const dm = document.createElement("span");
        dm.className = "text-base font-bold";
        dm.textContent = fmt.dayMonth.format(noonUtc(d.date));
        b.append(wd, dm);
        b.addEventListener("click", () => selectDate(d.date));
        return b;
      }),
    );
    selectDate(state.days[0]!.date);
  }

  function selectDate(date: string) {
    state.date = date;
    state.slot = null;
    details.hidden = true;
    for (const b of datesEl.querySelectorAll<HTMLButtonElement>("button")) b.setAttribute("aria-pressed", String(b.dataset.date === date));
    const day = state.days.find((d) => d.date === date);
    timeStep.hidden = false;
    if (!day?.slots.length) {
      const p = document.createElement("p");
      p.className = "col-span-full text-slate-500";
      p.textContent = msg("book.noTimesForDay");
      timesEl.replaceChildren(p);
      return;
    }
    timesEl.replaceChildren(
      ...day.slots.map((s) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className =
          "rounded-xl px-2 py-3 text-center font-semibold ring-1 ring-slate-200 transition hover:ring-brand-600 aria-pressed:bg-brand-700 aria-pressed:text-white aria-pressed:ring-brand-700";
        b.setAttribute("aria-pressed", "false");
        b.textContent = fmt.time.format(new Date(s.startAt));
        b.addEventListener("click", () => selectSlot(s, b));
        return b;
      }),
    );
  }

  function selectSlot(slot: { time: string; startAt: number }, button: HTMLButtonElement) {
    state.slot = slot;
    slotAlert.hidden = true;
    for (const b of timesEl.querySelectorAll("button")) b.setAttribute("aria-pressed", String(b === button));
    const service = cfg.services.find((s) => s.bookingType === state.bookingType)!;
    $("#summary-line").textContent = msg("book.summary", { type: msg(`booking.${state.bookingType}`), doctor: cfg.doctorName });
    $("#summary-when").textContent = `${fmt.longDate.format(noonUtc(state.date!))} · ${fmt.time.format(new Date(slot.startAt))}`;
    $("#summary-fee").textContent = msg("book.fee", { price: price(service.price) });
    details.hidden = false;
    clearErrors(details);
    mountTurnstile(details);
    details.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ------------------------------------------------------------ bot check
  let turnstileLoading: Promise<void> | null = null;
  const widgets = new Map<HTMLElement, string>();
  const tokens = new Map<HTMLFormElement, string>();

  function loadTurnstile(): Promise<void> {
    turnstileLoading ??= new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("turnstile"));
      document.head.append(s);
    });
    return turnstileLoading;
  }

  async function mountTurnstile(form: HTMLFormElement) {
    if (!cfg.turnstileSiteKey) return;
    const el = form.querySelector<HTMLElement>(".turnstile")!;
    if (widgets.has(el)) return;
    await loadTurnstile().catch(() => undefined);
    if (!window.turnstile || widgets.has(el)) return;
    widgets.set(
      el,
      window.turnstile.render(el, {
        sitekey: cfg.turnstileSiteKey,
        language: cfg.locale,
        callback: (token: string) => tokens.set(form, token),
        "expired-callback": () => tokens.delete(form),
      }),
    );
  }

  function resetTurnstile(form: HTMLFormElement) {
    const id = widgets.get(form.querySelector<HTMLElement>(".turnstile")!);
    if (id && window.turnstile) window.turnstile.reset(id);
    tokens.delete(form);
  }

  // ------------------------------------------------------------ forms
  function clearErrors(form: HTMLFormElement) {
    for (const el of form.querySelectorAll<HTMLElement>("[data-error-for]")) el.textContent = "";
    for (const el of form.querySelectorAll<HTMLElement>("[aria-invalid]")) el.removeAttribute("aria-invalid");
    const box = form.querySelector<HTMLElement>("[data-form-error]")!;
    box.classList.add("hidden");
    box.textContent = "";
  }

  function showErrors(form: HTMLFormElement, code: string, fields: Record<string, string> = {}) {
    for (const [field, reason] of Object.entries(fields)) {
      const slot = form.querySelector<HTMLElement>(`[data-error-for="${field}"]`);
      if (slot) slot.textContent = msg(`book.field.${reason}`) === `book.field.${reason}` ? msg("book.field.required") : msg(`book.field.${reason}`);
      form.querySelector(`[name="${field}"]`)?.setAttribute("aria-invalid", "true");
    }
    const box = form.querySelector<HTMLElement>("[data-form-error]")!;
    const key = `book.error.${code}`;
    box.textContent = cfg.messages[key] ?? msg("book.error.generic");
    box.classList.remove("hidden");
    (form.querySelector<HTMLElement>('[aria-invalid="true"]') ?? box).focus?.();
  }

  function collect(form: HTMLFormElement) {
    const data = new FormData(form);
    return {
      fullName: String(data.get("fullName") ?? "").trim(),
      phone: String(data.get("phone") ?? "").trim(),
      note: String(data.get("note") ?? "").trim() || null,
      consent: data.get("consent") === "on",
      preferredLocale: cfg.locale,
      turnstileToken: tokens.get(form),
    };
  }

  /** Quick checks before sending; the server checks everything again. */
  function precheck(form: HTMLFormElement, v: ReturnType<typeof collect>): boolean {
    const fields: Record<string, string> = {};
    if (v.fullName.length < 2) fields.fullName = "required";
    if (v.phone.replace(/\D/g, "").length < 9) fields.phone = v.phone ? "invalid_phone" : "required";
    if (!v.consent) fields.consent = "consent_required";
    if (Object.keys(fields).length) {
      showErrors(form, "validation_failed", fields);
      return false;
    }
    return true;
  }

  async function send(form: HTMLFormElement, url: string, body: unknown): Promise<{ ok: true; data: unknown } | { ok: false; code: string; fields?: Record<string, string> }> {
    const button = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    const label = button.textContent;
    button.disabled = true;
    button.textContent = msg("book.submitting");
    try {
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const data = (await res.json().catch(() => ({}))) as ApiError;
      if (res.ok) return { ok: true, data };
      return { ok: false, code: data.error?.code ?? "generic", fields: data.error?.fields };
    } catch {
      return { ok: false, code: "network" };
    } finally {
      button.disabled = false;
      button.textContent = label;
    }
  }

  details.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearErrors(details);
    const v = collect(details);
    if (!state.slot || !precheck(details, v)) return;
    const result = await send(details, "/api/public/bookings", {
      ...v,
      doctorId: cfg.doctorId,
      bookingType: state.bookingType,
      startAt: state.slot.startAt,
    });
    if (result.ok) {
      const b = (result.data as { booking: { referenceCode: string; startAt: number; bookingType: string } }).booking;
      showDone("book.doneTitle", "book.doneText", b.referenceCode, `${fmt.longDate.format(noonUtc(state.date!))} · ${fmt.time.format(new Date(b.startAt))}`);
      return;
    }
    resetTurnstile(details);
    if (result.code === "slot_taken" || result.code === "slot_unavailable") {
      // Someone else took the time: refresh the free times and ask for another one.
      const keep = state.date;
      await loadSlots();
      if (keep && state.days.some((d) => d.date === keep)) selectDate(keep);
      slotAlert.textContent = msg(`book.error.${result.code}`);
      slotAlert.hidden = false;
      slotAlert.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    showErrors(details, result.code, result.fields);
  });

  request.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearErrors(request);
    const v = collect(request);
    if (!precheck(request, v)) return;
    const data = new FormData(request);
    const result = await send(request, "/api/public/requests", {
      ...v,
      doctorId: cfg.doctorId,
      bookingType: String(data.get("bookingType")),
      preferredDate: String(data.get("preferredDate") ?? "") || null,
      preferredPeriod: String(data.get("preferredPeriod") ?? "any"),
    });
    if (result.ok) {
      const r = (result.data as { request: { referenceCode: string; bookingType: string; preferredDate: string | null } }).request;
      state.bookingType = r.bookingType;
      showDone("request.doneTitle", "request.doneText", r.referenceCode, r.preferredDate ? fmt.longDate.format(noonUtc(r.preferredDate)) : "");
      return;
    }
    resetTurnstile(request);
    showErrors(request, result.code, result.fields);
  });

  function showDone(titleKey: string, textKey: string, ref: string, when: string) {
    flow.hidden = true;
    request.hidden = true;
    done.hidden = false;
    $("#done-title").textContent = msg(titleKey);
    $("#done-text").textContent = msg(textKey);
    $("#done-ref").textContent = ref;
    $("#done-summary").textContent = msg("book.summary", { type: msg(`booking.${state.bookingType}`), doctor: cfg.doctorName });
    $("#done-when").textContent = when;
    const wa = $<HTMLAnchorElement>("#done-whatsapp");
    if (cfg.whatsapp) {
      wa.href = `https://wa.me/${cfg.whatsapp}?text=${encodeURIComponent(msg("book.whatsappMessage", { ref }))}`;
      wa.hidden = false;
    }
    done.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ------------------------------------------------------------ navigation between parts
  for (const input of root.querySelectorAll<HTMLInputElement>('input[name="bookingType"]')) {
    input.addEventListener("change", () => {
      state.bookingType = input.value;
      void loadSlots();
    });
  }
  $("#change-time").addEventListener("click", () => {
    details.hidden = true;
    timeStep.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  $("#open-request").addEventListener("click", () => {
    flow.hidden = true;
    request.hidden = false;
    const typeSelect = request.querySelector<HTMLSelectElement>('select[name="bookingType"]')!;
    typeSelect.value = state.bookingType;
    // Carry over what the patient already typed.
    for (const f of ["fullName", "phone", "note"]) {
      const from = details.querySelector<HTMLInputElement>(`[name="${f}"]`);
      const to = request.querySelector<HTMLInputElement>(`[name="${f}"]`);
      if (from?.value && to && !to.value) to.value = from.value;
    }
    mountTurnstile(request);
    request.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  $("#close-request").addEventListener("click", () => {
    request.hidden = true;
    flow.hidden = false;
  });

  void loadSlots();
}
