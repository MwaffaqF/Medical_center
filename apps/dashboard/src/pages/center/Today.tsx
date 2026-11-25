import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { APPOINTMENT_STATUSES, type AppointmentStatus } from "@mc/shared";
import { api } from "../../api";
import { useI18n } from "../../i18n";
import { AppointmentSummary, QuickActions, RECEPTION, useDoctors, useWhatsApp, useWhen } from "../../reception";
import type { Appointment } from "../../types";
import { Alert, Badge, Button, Card, Empty, Loading, PageHeader, SelectField } from "../../ui";

/** Pending online bookings older than this are highlighted (spec §7: no auto-expiry in the MVP). */
const PENDING_ALERT_HOURS = 12;

/** Today screen (spec §11.1): pending confirmations, new requests, today's agenda, tomorrow's reminders. */
export function TodayPage({ readOnly, top }: { readOnly: boolean; top?: ReactNode }) {
  const { t } = useI18n();
  const when = useWhen();
  // Refreshes every minute so new online bookings appear without reloading.
  const today = useQuery({ queryKey: [RECEPTION, "today"], queryFn: api.reception.today, refetchInterval: 60_000 });

  return (
    <>
      <PageHeader
        title={today.data ? `${t("today.title")} · ${when.date(today.data.date)}` : t("today.title")}
        actions={
          <>
            <Button variant="secondary" onClick={() => today.refetch()} busy={today.isFetching && !today.isPending}>
              {t("common.refresh")}
            </Button>
            {!readOnly && (
              <Link
                to="/appointments/new"
                className="inline-flex items-center rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800"
              >
                + {t("appt.new")}
              </Link>
            )}
          </>
        }
      />
      <div className="space-y-6">
        {top}
        {today.isPending ? (
          <Loading />
        ) : today.error ? (
          <Alert>{t("error.generic")}</Alert>
        ) : (
          <>
            <RequestsBanner count={today.data.newRequests} />
            <PendingQueue items={today.data.pending} readOnly={readOnly} />
            <Agenda items={today.data.agenda} readOnly={readOnly} />
            <Tomorrow items={today.data.tomorrow} readOnly={readOnly} />
          </>
        )}
      </div>
    </>
  );
}

function RequestsBanner({ count }: { count: number }) {
  const { t } = useI18n();
  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-2 rounded-2xl px-4 py-3 ring-1 ${
        count ? "bg-sky-50 text-sky-950 ring-sky-200" : "bg-white text-slate-500 ring-slate-200"
      }`}
    >
      <span className="font-medium">{count ? t("today.requests", { n: count }) : t("today.requestsNone")}</span>
      <Link to="/requests" className="text-sm font-semibold text-brand-700 hover:underline">
        {t("today.openInbox")}
      </Link>
    </div>
  );
}

function PendingQueue({ items, readOnly }: { items: Appointment[]; readOnly: boolean }) {
  const { t } = useI18n();
  const wa = useWhatsApp();
  const [busyId, setBusyId] = useState<string | null>(null);

  async function confirmAndSend(a: Appointment) {
    setBusyId(a.id);
    await wa.send(async () => {
      await api.reception.setStatus(a.id, { action: "confirm" });
      return api.reception.appointmentMessage(a.id, "confirmation");
    });
    setBusyId(null);
  }

  return (
    <Card title={`${t("today.pending")}${items.length ? ` · ${items.length}` : ""}`}>
      {items.length > 0 && <p className="-mt-2 mb-3 text-sm text-slate-500">{t("today.pendingHint")}</p>}
      {wa.error && (
        <div className="mb-3">
          <Alert>{wa.error}</Alert>
        </div>
      )}
      {items.length === 0 ? (
        <Empty>{t("today.pendingEmpty")}</Empty>
      ) : (
        <ul className="divide-y divide-slate-100">
          {items.map((a) => {
            const hours = Math.floor((Date.now() - new Date(a.createdAt).getTime()) / 3_600_000);
            return (
              <li key={a.id} className="flex flex-wrap items-center gap-3 py-3">
                <AppointmentSummary appointment={a} showDate />
                <div className="flex items-center gap-2">
                  {hours >= 1 && <Badge tone={hours >= PENDING_ALERT_HOURS ? "red" : "slate"}>{t("today.waiting", { hours })}</Badge>}
                  {!readOnly && (
                    <Button onClick={() => confirmAndSend(a)} busy={busyId === a.id} disabled={!!busyId}>
                      {t("action.confirmSend")}
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function Agenda({ items, readOnly }: { items: Appointment[]; readOnly: boolean }) {
  const { t, pick } = useI18n();
  const doctors = useDoctors();
  const [doctorId, setDoctorId] = useState("");
  const [status, setStatus] = useState<AppointmentStatus | "">("");
  const shown = items.filter((a) => (!doctorId || a.doctor.id === doctorId) && (!status || a.status === status));
  const doctorOptions = (doctors.data?.doctors ?? []).filter((d) => items.some((a) => a.doctor.id === d.id));

  return (
    <Card title={`${t("today.agenda")} · ${items.length}`}>
      <div className="mb-3 grid gap-3 sm:grid-cols-2">
        <SelectField label={t("appt.doctor")} value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
          <option value="">{t("availability.allDoctors")}</option>
          {doctorOptions.map((d) => (
            <option key={d.id} value={d.id}>
              {pick(d.nameAr, d.nameEn)}
            </option>
          ))}
        </SelectField>
        <SelectField label={t("common.status")} value={status} onChange={(e) => setStatus(e.target.value as AppointmentStatus | "")}>
          <option value="">{t("today.allStatuses")}</option>
          {APPOINTMENT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`status.${s}`)}
            </option>
          ))}
        </SelectField>
      </div>
      {shown.length === 0 ? (
        <Empty>{t("today.agendaEmpty")}</Empty>
      ) : (
        <ul className="divide-y divide-slate-100">
          {shown.map((a) => (
            <li key={a.id} className={`flex flex-wrap items-center gap-3 py-3 ${a.status === "cancelled" ? "opacity-60" : ""}`}>
              <AppointmentSummary appointment={a} />
              <QuickActions appointment={a} readOnly={readOnly} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Tomorrow({ items, readOnly }: { items: (Appointment & { reminderSent: boolean })[]; readOnly: boolean }) {
  const { t } = useI18n();
  const wa = useWhatsApp();
  const [busyId, setBusyId] = useState<string | null>(null);
  const sent = items.filter((a) => a.reminderSent).length;

  async function remind(a: Appointment) {
    setBusyId(a.id);
    await wa.send(() => api.reception.appointmentMessage(a.id, "reminder"));
    setBusyId(null);
  }

  return (
    <Card title={`${t("today.tomorrow")}${items.length ? ` · ${sent}/${items.length}` : ""}`}>
      {wa.error && (
        <div className="mb-3">
          <Alert>{wa.error}</Alert>
        </div>
      )}
      {items.length === 0 ? (
        <Empty>{t("today.tomorrowEmpty")}</Empty>
      ) : (
        <ul className="divide-y divide-slate-100">
          {items.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-3 py-3">
              <AppointmentSummary appointment={a} />
              {a.reminderSent && <Badge tone="green">✓ {t("today.reminderSent")}</Badge>}
              {!readOnly && (
                <Button
                  variant={a.reminderSent ? "ghost" : "secondary"}
                  onClick={() => remind(a)}
                  busy={busyId === a.id}
                  disabled={!!busyId}
                >
                  {t("today.sendReminder")}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
