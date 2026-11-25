import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { availableActions, type AppointmentStatus, type StatusAction } from "@mc/shared";
import { api } from "./api";
import { useI18n } from "./i18n";
import type { Appointment, WhatsAppMessage } from "./types";
import { Alert, Badge, Button, Modal, TextField, useErrorText } from "./ui";

/** Every reception query starts with this key, so one invalidation refreshes all screens. */
export const RECEPTION = "reception";

export function useInvalidateReception() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: [RECEPTION] });
}

// ---------------------------------------------------------------- center data

export function useCenter() {
  return useQuery({ queryKey: ["center", "settings"], queryFn: api.center.settings }).data?.center;
}

export function useDoctors() {
  return useQuery({ queryKey: ["center", "doctors"], queryFn: api.center.doctors });
}

/** Dates, times and money shown in the center's time zone and the staff member's language. */
export function useWhen() {
  const { locale, t } = useI18n();
  const center = useCenter();
  const timeZone = center?.timezone ?? "Asia/Damascus";
  const tag = locale === "ar" ? "ar-SY-u-nu-latn" : "en-GB";
  const fmt = (opts: Intl.DateTimeFormatOptions, tz = timeZone) => new Intl.DateTimeFormat(tag, { ...opts, timeZone: tz });
  const time = fmt({ hour: "numeric", minute: "2-digit" });
  const day = fmt({ weekday: "short", day: "numeric", month: "short" });
  const dayTime = fmt({ weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  const fullDay = fmt({ weekday: "long", day: "numeric", month: "long" }, "UTC");
  const shortDay = fmt({ weekday: "short", day: "numeric", month: "short" }, "UTC");
  const hhmm = fmt({ hour: "numeric", minute: "2-digit" }, "UTC");
  const currency = center?.currency ?? "SYP";
  return {
    timeZone,
    slotStep: center?.slotStepMinutes ?? 10,
    time: (v: string | number) => time.format(new Date(v)),
    day: (v: string | number) => day.format(new Date(v)),
    dayTime: (v: string | number) => dayTime.format(new Date(v)),
    /** A "YYYY-MM-DD" calendar date (no time zone shift). */
    date: (d: string) => fullDay.format(new Date(`${d}T12:00:00Z`)),
    shortDate: (d: string) => shortDay.format(new Date(`${d}T12:00:00Z`)),
    /** A "HH:MM" wall-clock time. */
    clock: (hm: string) => hhmm.format(new Date(`1970-01-01T${hm}:00Z`)),
    money: (n: number) => `${new Intl.NumberFormat(tag).format(n)} ${currency === "SYP" ? t("common.currency.SYP") : currency}`,
  };
}

// ---------------------------------------------------------------- status

export const STATUS_TONE: Record<AppointmentStatus, "amber" | "brand" | "green" | "slate" | "red"> = {
  pending: "amber",
  confirmed: "brand",
  checked_in: "green",
  completed: "slate",
  no_show: "red",
  cancelled: "slate",
};

/** Card colours for the calendar, matching the badge tones (used with `border-s-4`). */
export const STATUS_CARD: Record<AppointmentStatus, string> = {
  pending: "bg-amber-100 border-amber-500 text-amber-950",
  confirmed: "bg-white border-brand-600 text-slate-900 shadow-sm",
  checked_in: "bg-emerald-100 border-emerald-600 text-emerald-950",
  completed: "bg-slate-100 border-slate-400 text-slate-600",
  no_show: "bg-red-50 border-red-500 text-red-900",
  cancelled: "bg-white/80 border-slate-300 text-slate-400 line-through",
};

export function StatusBadge({ status }: { status: AppointmentStatus }) {
  const { t } = useI18n();
  return <Badge tone={STATUS_TONE[status]}>{t(`status.${status}`)}</Badge>;
}

// ---------------------------------------------------------------- WhatsApp

/**
 * Opens WhatsApp with a pre-filled message (spec §13). The new tab is opened right away,
 * inside the click, so browsers don't treat it as an unwanted pop-up; its address is set
 * once the server has prepared the text and logged the message.
 */
export function useWhatsApp() {
  const { t } = useI18n();
  const errorText = useErrorText();
  const invalidate = useInvalidateReception();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send(make: () => Promise<WhatsAppMessage>) {
    setError(null);
    setBusy(true);
    const win = window.open("", "_blank");
    try {
      const msg = await make();
      if (win) {
        win.opener = null;
        win.location.href = msg.url;
      } else if (!window.open(msg.url, "_blank", "noopener")) {
        setError(t("error.popup_blocked"));
      }
      await invalidate();
    } catch (err) {
      win?.close();
      setError(errorText(err).message);
    } finally {
      setBusy(false);
    }
  }
  return { send, error, busy, clearError: () => setError(null) };
}

// ---------------------------------------------------------------- status actions

/** Changes an appointment's status. Cancelling asks for a reason first (see CancelModal). */
export function useStatusAction() {
  const invalidate = useInvalidateReception();
  return useMutation({
    mutationFn: ({ id, action, reason }: { id: string; action: StatusAction; reason?: string }) =>
      api.reception.setStatus(id, { action, reason }),
    onSuccess: invalidate,
  });
}

/** Quick actions for a row on the Today screen (spec §11.1): check in, complete, no-show. */
export function QuickActions({ appointment, readOnly }: { appointment: Appointment; readOnly?: boolean }) {
  const { t } = useI18n();
  const errorText = useErrorText();
  const status = useStatusAction();
  if (readOnly) return null;
  const allowed = availableActions(appointment.status).filter((a) => a === "check_in" || a === "complete" || a === "no_show");
  if (!allowed.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {allowed.map((action) => (
        <Button
          key={action}
          variant={action === "no_show" ? "danger" : "secondary"}
          className="!px-3 !py-1.5"
          disabled={status.isPending}
          onClick={() => status.mutate({ id: appointment.id, action })}
        >
          {t(`action.${action}`)}
        </Button>
      ))}
      {status.error && <span className="text-xs text-red-600">{errorText(status.error).message}</span>}
    </div>
  );
}

export function CancelModal({ appointment, onClose, onDone }: { appointment: Appointment; onClose: () => void; onDone?: () => void }) {
  const { t } = useI18n();
  const errorText = useErrorText();
  const status = useStatusAction();
  const [reason, setReason] = useState("");

  function submit(e: FormEvent) {
    e.preventDefault();
    status.mutate({ id: appointment.id, action: "cancel", reason }, { onSuccess: () => (onDone ?? onClose)() });
  }
  const err = status.error ? errorText(status.error) : null;
  return (
    <Modal open onClose={onClose} title={t("appt.cancelTitle")}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-slate-600">{t("appt.cancelHint")}</p>
        <TextField
          label={t("appt.cancelReason")}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={300}
          required
          autoFocus
          error={err?.fields.reason}
        />
        {err?.message && <Alert>{err.message}</Alert>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t("common.close")}
          </Button>
          <Button type="submit" variant="danger" busy={status.isPending} disabled={!reason.trim()}>
            {t("action.cancel")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- rows

/** One appointment line: time, patient, doctor, type, status. Links to the appointment panel. */
export function AppointmentSummary({ appointment: a, showDate }: { appointment: Appointment; showDate?: boolean }) {
  const { t, pick } = useI18n();
  const when = useWhen();
  return (
    <Link to={`/appointments/${a.id}`} className="flex min-w-0 flex-1 items-start gap-3 hover:opacity-80">
      <div className="w-20 shrink-0">
        <p className="font-semibold tabular-nums">{when.time(a.startAt)}</p>
        {showDate && <p className="text-xs text-slate-500">{when.day(a.startAt)}</p>}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{a.patient.fullName}</p>
        <p className="truncate text-sm text-slate-500">
          {pick(a.doctor.nameAr, a.doctor.nameEn)} · {t(`booking.${a.bookingType}`)}
        </p>
        <div className="mt-1 flex flex-wrap gap-1">
          <StatusBadge status={a.status} />
          {a.source === "website" && <Badge>{t("source.website")}</Badge>}
          {a.revisitFlag && a.bookingType === "revisit" && <Badge tone="amber">{t("appt.revisitBadge")}</Badge>}
        </div>
      </div>
    </Link>
  );
}

export function Phone({ value }: { value: string }) {
  return (
    <a href={`tel:${value}`} dir="ltr" className="text-brand-700 hover:underline">
      {value}
    </a>
  );
}
