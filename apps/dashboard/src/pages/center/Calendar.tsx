import { useQuery } from "@tanstack/react-query";
import type { MouseEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { addDays, timeToMinutes, todayIn, weekStart, zonedParts, type SessionUser } from "@mc/shared";
import { api } from "../../api";
import { clickToTime, minuteOfDay, placeInLanes, visibleRange } from "../../calendar-layout";
import { useI18n } from "../../i18n";
import { RECEPTION, STATUS_CARD, useDoctors, useWhen } from "../../reception";
import type { Appointment, AvailabilitySession } from "../../types";
import { Alert, Button, Empty, Loading, PageHeader, SelectField, Toggle } from "../../ui";

/** Pixels per minute: a 10-minute slot is 16 px tall. */
const PX = 1.6;

type Column = { key: string; date: string; doctorId: string; label: string; sub?: string; isToday: boolean };

/** Calendar (spec §11.2): day view with doctors as columns, week view for one doctor. */
export function CalendarPage({ user }: { user: SessionUser }) {
  const { t, pick } = useI18n();
  const when = useWhen();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const today = todayIn(when.timeZone);
  const view = params.get("view") === "week" ? "week" : "day";
  const date = params.get("date") ?? today;
  const showCancelled = params.get("cancelled") === "1";
  const doctors = useDoctors();
  const active = (doctors.data?.doctors ?? []).filter((d) => d.isActive);
  const doctorId = params.get("doctor") ?? active[0]?.id ?? "";
  const readOnly = user.role === "doctor";

  const from = view === "week" ? weekStart(date) : date;
  const to = view === "week" ? addDays(from, 6) : date;
  const filterDoctor = view === "week" ? doctorId : undefined;

  const sessions = useQuery({
    queryKey: [RECEPTION, "calendar-sessions", from, to, filterDoctor],
    queryFn: () => api.center.availability({ from, to, doctorId: filterDoctor }),
    enabled: view === "day" || !!doctorId,
  });
  const appointments = useQuery({
    queryKey: [RECEPTION, "calendar-appointments", from, to, filterDoctor],
    queryFn: () => api.reception.appointments({ from, to, doctorId: filterDoctor }),
    enabled: view === "day" || !!doctorId,
    refetchInterval: 60_000,
  });

  const set = (next: Record<string, string | null>) =>
    setParams((p) => {
      const n = new URLSearchParams(p);
      for (const [k, v] of Object.entries(next)) {
        if (v === null) n.delete(k);
        else n.set(k, v);
      }
      return n;
    });

  const allSessions = sessions.data?.sessions ?? [];
  const allAppointments = (appointments.data?.appointments ?? []).filter((a) => showCancelled || a.status !== "cancelled");
  const localDate = (a: Appointment) => zonedParts(new Date(a.startAt).getTime(), when.timeZone).date;

  const columns: Column[] =
    view === "week"
      ? Array.from({ length: 7 }, (_, i) => addDays(from, i)).map((d) => ({
          key: d,
          date: d,
          doctorId,
          label: when.shortDate(d),
          isToday: d === today,
        }))
      : active
          .filter((d) => allSessions.some((s) => s.doctorId === d.id) || allAppointments.some((a) => a.doctor.id === d.id))
          .map((d) => ({ key: d.id, date, doctorId: d.id, label: pick(d.nameAr, d.nameEn), isToday: date === today }));

  const inColumn = <T extends { doctorId: string; date: string }>(c: Column, x: T) => x.doctorId === c.doctorId && x.date === c.date;
  const sessionBlocks = allSessions.map((s) => ({ ...s, start: timeToMinutes(s.startTime), end: timeToMinutes(s.endTime) }));
  const apptBlocks = allAppointments.map((a) => {
    const start = minuteOfDay(new Date(a.startAt).getTime(), when.timeZone);
    const length = Math.round((new Date(a.endAt).getTime() - new Date(a.startAt).getTime()) / 60_000);
    return { ...a, doctorId: a.doctor.id, date: localDate(a), start, end: Math.min(24 * 60, start + length) };
  });
  const range = visibleRange([...sessionBlocks, ...apptBlocks]);
  const height = (range.end - range.start) * PX;
  const hours = Array.from({ length: (range.end - range.start) / 60 }, (_, i) => range.start + i * 60);

  function openSlot(e: MouseEvent<HTMLDivElement>, c: Column) {
    if (readOnly || c.date < today) return;
    const y = e.clientY - e.currentTarget.getBoundingClientRect().top;
    const time = clickToTime(range.start, y / PX, when.slotStep);
    navigate(`/appointments/new?doctor=${c.doctorId}&date=${c.date}&time=${time}`);
  }

  const step = view === "week" ? 7 : 1;
  const title = view === "week" ? `${when.shortDate(from)} – ${when.shortDate(to)}` : when.date(date);

  return (
    <>
      <PageHeader
        title={t("calendar.title")}
        actions={
          !readOnly && (
            <Link
              to="/appointments/new"
              className="inline-flex items-center rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800"
            >
              + {t("appt.new")}
            </Link>
          )
        }
      />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="inline-flex rounded-lg ring-1 ring-slate-300" role="group">
          {(["day", "week"] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => set({ view: v })}
              className={`px-4 py-2 text-sm font-medium first:rounded-s-lg last:rounded-e-lg ${view === v ? "bg-brand-700 text-white" : "bg-white hover:bg-slate-50"}`}
            >
              {t(`calendar.${v}`)}
            </button>
          ))}
        </div>
        {view === "week" && active.length > 0 && (
          <div className="w-full sm:w-64">
            <SelectField label={t("appt.doctor")} value={doctorId} onChange={(e) => set({ doctor: e.target.value })}>
              {active.map((d) => (
                <option key={d.id} value={d.id}>
                  {pick(d.nameAr, d.nameEn)}
                </option>
              ))}
            </SelectField>
          </div>
        )}
        <div className="flex items-center gap-1">
          <Button variant="secondary" aria-label={t("calendar.prev")} onClick={() => set({ date: addDays(date, -step) })}>
            <span className="rtl:rotate-180">‹</span>
          </Button>
          <input
            type="date"
            aria-label={t("appt.date")}
            value={date}
            onChange={(e) => e.target.value && set({ date: e.target.value })}
            className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
          />
          <Button variant="secondary" aria-label={t("calendar.next")} onClick={() => set({ date: addDays(date, step) })}>
            <span className="rtl:rotate-180">›</span>
          </Button>
          {date !== today && (
            <Button variant="ghost" onClick={() => set({ date: null })}>
              {t("calendar.today")}
            </Button>
          )}
        </div>
        <Toggle checked={showCancelled} onChange={(v) => set({ cancelled: v ? "1" : null })} label={t("calendar.showCancelled")} />
      </div>
      <p className="mb-1 font-semibold">{title}</p>
      <p className="mb-3 text-sm text-slate-500">{t("calendar.hint")}</p>

      {sessions.isPending || appointments.isPending || doctors.isPending ? (
        <Loading />
      ) : sessions.error || appointments.error ? (
        <Alert>{t("error.generic")}</Alert>
      ) : columns.length === 0 ? (
        <Empty>{t("availability.noSessions")}</Empty>
      ) : (
        <div className="overflow-x-auto rounded-2xl bg-white ring-1 ring-slate-200">
          <div className="flex">
            {/* time gutter */}
            <div className="sticky start-0 z-[2] w-16 shrink-0 border-e border-slate-200 bg-white">
              <div className="h-10 border-b border-slate-200" />
              <div className="relative" style={{ height }}>
                {hours.map((m) => (
                  <span
                    key={m}
                    className="absolute end-1.5 -translate-y-1/2 whitespace-nowrap text-xs text-slate-400 tabular-nums"
                    style={{ top: (m - range.start) * PX }}
                  >
                    {m > range.start ? when.clock(`${String(m / 60).padStart(2, "0")}:00`) : ""}
                  </span>
                ))}
              </div>
            </div>
            {columns.map((c) => (
              <div key={c.key} className="min-w-40 flex-1 border-e border-slate-100 last:border-e-0">
                <div
                  className={`flex h-10 items-center justify-center border-b border-slate-200 px-2 text-center text-sm font-semibold ${c.isToday ? "text-brand-700" : ""}`}
                >
                  <span className="truncate">{c.label}</span>
                </div>
                <div
                  className={`relative ${!readOnly && c.date >= today ? "cursor-copy" : ""}`}
                  style={{ height }}
                  onClick={(e) => openSlot(e, c)}
                >
                  {hours.map((m) => (
                    <div
                      key={m}
                      className="pointer-events-none absolute inset-x-0 border-t border-slate-100"
                      style={{ top: (m - range.start) * PX }}
                    />
                  ))}
                  {sessionBlocks
                    .filter((s) => inColumn(c, s))
                    .map((s) => (
                      <SessionBlock key={s.id} session={s} top={(s.start - range.start) * PX} height={(s.end - s.start) * PX} />
                    ))}
                  {placeInLanes(apptBlocks.filter((a) => inColumn(c, a))).map((a) => {
                    const h = Math.max(18, (a.end - a.start) * PX - 1);
                    return (
                      <Link
                        key={a.id}
                        to={`/appointments/${a.id}`}
                        onClick={(e) => e.stopPropagation()}
                        title={`${when.time(a.startAt)} ${a.patient.fullName} · ${t(`status.${a.status}`)}`}
                        className={`absolute z-[1] overflow-hidden rounded-md border-s-4 px-1.5 py-0.5 text-xs leading-tight ring-1 ring-black/5 hover:z-[3] hover:shadow-md ${STATUS_CARD[a.status]}`}
                        style={{
                          top: (a.start - range.start) * PX,
                          height: h,
                          insetInlineStart: `calc(${(a.lane / a.lanes) * 100}% + 2px)`,
                          width: `calc(${100 / a.lanes}% - 4px)`,
                        }}
                      >
                        <span className="block truncate">
                          <span className="font-semibold tabular-nums">{when.time(a.startAt)}</span>{" "}
                          <span className="font-medium">{a.patient.fullName}</span>
                        </span>
                        {h >= 30 && <span className="block truncate opacity-80">{t(`booking.${a.bookingType}`)}</span>}
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function SessionBlock({ session, top, height }: { session: AvailabilitySession; top: number; height: number }) {
  const { t } = useI18n();
  const closed = session.status === "closed";
  return (
    <div
      className={`pointer-events-none absolute inset-x-0 border-y ${
        closed
          ? "border-slate-200 bg-[repeating-linear-gradient(45deg,#f1f5f9,#f1f5f9_6px,#fff_6px,#fff_12px)]"
          : "border-brand-600/20 bg-brand-50/70"
      }`}
      style={{ top, height }}
    >
      {closed && <span className="absolute end-1 top-0.5 text-[10px] text-slate-400">{t("availability.closed")}</span>}
    </div>
  );
}
