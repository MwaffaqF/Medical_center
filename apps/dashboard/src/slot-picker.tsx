import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { addDays, todayIn, zonedToUtc, type BookingType } from "@mc/shared";
import { api } from "./api";
import { useI18n } from "./i18n";
import { RECEPTION, useWhen } from "./reception";
import { Alert, Button, Loading, TextField } from "./ui";

export type SlotChoice = { startAt: number; override: boolean };

/**
 * Picks a start time for reception: free times by day (same rules as the website, without
 * the minimum notice), or any other time as an override after a warning (spec §8.6).
 */
export function SlotPicker({
  doctorId,
  bookingType,
  initialDate,
  value,
  onChange,
}: {
  doctorId: string;
  bookingType: BookingType;
  initialDate?: string;
  value: SlotChoice | null;
  onChange: (v: SlotChoice | null) => void;
}) {
  const { t } = useI18n();
  const when = useWhen();
  const today = todayIn(when.timeZone);
  const start = initialDate && initialDate > today ? initialDate : today;
  const [from, setFrom] = useState(start);
  const [day, setDay] = useState(start);
  const [otherOpen, setOtherOpen] = useState(false);
  const [otherTime, setOtherTime] = useState("");

  const slots = useQuery({
    queryKey: [RECEPTION, "slots", doctorId, bookingType, from],
    queryFn: () => api.center.slots(doctorId, bookingType, from, 7),
  });
  const days = slots.data?.days ?? [];
  const daySlots = days.find((d) => d.date === day)?.slots ?? [];

  // Until reception picks a day, show the first day that has free times.
  const [dayPicked, setDayPicked] = useState(false);
  useEffect(() => {
    if (dayPicked || value || !slots.data) return;
    const first = slots.data.days.find((d) => d.slots.length);
    if (first && first.date !== day) setDay(first.date);
  }, [slots.data, dayPicked, value, day]);

  function moveWeek(delta: number) {
    const next = addDays(from, delta * 7);
    const clamped = next < today ? today : next;
    setFrom(clamped);
    setDay(clamped);
    onChange(null);
  }

  function pickOther(time: string) {
    setOtherTime(time);
    onChange(time ? { startAt: zonedToUtc(day, time, when.timeZone), override: true } : null);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1">
        <Button variant="secondary" aria-label={t("calendar.prev")} disabled={from <= today} onClick={() => moveWeek(-1)}>
          <span className="rtl:rotate-180">‹</span>
        </Button>
        <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto pb-1">
          {Array.from({ length: 7 }, (_, i) => addDays(from, i)).map((d) => {
            const n = days.find((x) => x.date === d)?.slots.length ?? 0;
            const selected = d === day;
            return (
              <button
                key={d}
                type="button"
                onClick={() => {
                  setDay(d);
                  setDayPicked(true);
                  onChange(null);
                  setOtherTime("");
                }}
                className={`min-w-16 shrink-0 rounded-lg px-2 py-1.5 text-center text-sm ring-1 ${
                  selected
                    ? "bg-brand-700 text-white ring-brand-700"
                    : n
                      ? "bg-white ring-slate-300 hover:bg-slate-50"
                      : "bg-slate-50 text-slate-400 ring-slate-200"
                }`}
              >
                <span className="block font-medium">{when.shortDate(d)}</span>
                <span className={`block text-xs ${selected ? "text-white/80" : ""}`}>{slots.isPending ? "…" : n}</span>
              </button>
            );
          })}
        </div>
        <Button variant="secondary" aria-label={t("calendar.next")} onClick={() => moveWeek(1)}>
          <span className="rtl:rotate-180">›</span>
        </Button>
      </div>

      <div>
        <p className="mb-2 text-sm font-medium">
          {t("newAppt.freeTimes")} · {when.date(day)}
          {slots.data && (
            <span className="ms-2 font-normal text-slate-500">
              {slots.data.durationMinutes} {t("common.minutes")} · {when.money(slots.data.price)}
            </span>
          )}
        </p>
        {slots.isPending ? (
          <Loading />
        ) : slots.error ? (
          <Alert>{t("error.booking_type_not_offered")}</Alert>
        ) : daySlots.length === 0 ? (
          <p className="text-sm text-slate-500">{t("newAppt.noFreeTimes")}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {daySlots.map((s) => {
              const selected = value && !value.override && value.startAt === s.startAt;
              return (
                <button
                  key={s.startAt}
                  type="button"
                  onClick={() => {
                    setOtherTime("");
                    onChange({ startAt: s.startAt, override: false });
                  }}
                  className={`rounded-lg px-3 py-2 text-sm font-medium tabular-nums ring-1 ${
                    selected ? "bg-brand-700 text-white ring-brand-700" : "bg-white ring-slate-300 hover:bg-brand-50"
                  }`}
                >
                  {when.clock(s.time)}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div>
        {!otherOpen ? (
          <Button variant="ghost" className="!px-0" onClick={() => setOtherOpen(true)}>
            {t("newAppt.otherTime")}
          </Button>
        ) : (
          <div className="max-w-48">
            <TextField
              label={t("newAppt.otherTime")}
              type="time"
              step={300}
              value={otherTime}
              onChange={(e) => pickOther(e.target.value)}
            />
          </div>
        )}
        {value?.override && (
          <div className="mt-2">
            <Alert tone="warning">{t("newAppt.overrideWarning")}</Alert>
          </div>
        )}
      </div>
    </div>
  );
}
