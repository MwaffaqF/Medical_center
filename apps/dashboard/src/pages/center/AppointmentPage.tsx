import { useMutation, useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import {
  availableActions,
  MESSAGE_TEMPLATE_KEYS,
  zonedParts,
  type BookingType,
  type MessageTemplateKey,
  type SessionUser,
} from "@mc/shared";
import { api, ApiRequestError } from "../../api";
import { useI18n } from "../../i18n";
import {
  CancelModal,
  Phone,
  RECEPTION,
  StatusBadge,
  useDoctors,
  useInvalidateReception,
  useStatusAction,
  useWhatsApp,
  useWhen,
} from "../../reception";
import { SlotPicker, type SlotChoice } from "../../slot-picker";
import type { Appointment, AppointmentDetail } from "../../types";
import {
  Alert,
  Badge,
  Button,
  Card,
  Empty,
  Loading,
  Modal,
  PageHeader,
  SelectField,
  TextAreaField,
  useErrorText,
  useFlash,
} from "../../ui";

/** Appointment panel (spec §11.3). */
export function AppointmentPage({ user }: { user: SessionUser }) {
  const { id } = useParams();
  const { t } = useI18n();
  const detail = useQuery({ queryKey: [RECEPTION, "appointment", id], queryFn: () => api.reception.appointment(id!) });
  if (detail.isPending) return <Loading />;
  if (detail.error) {
    return (
      <>
        <PageHeader title={t("appt.new")} back="/" />
        <Alert>{t("error.not_found")}</Alert>
      </>
    );
  }
  return <Panel data={detail.data} readOnly={user.role === "doctor"} />;
}

function Panel({ data, readOnly }: { data: AppointmentDetail; readOnly: boolean }) {
  const { t, pick } = useI18n();
  const when = useWhen();
  const a = data.appointment;
  const [cancelling, setCancelling] = useState(false);
  const [rescheduling, setRescheduling] = useState(false);
  /** After booking, cancelling or moving, offer the matching WhatsApp message in one click. */
  const [params] = useSearchParams();
  const [suggest, setSuggest] = useState<"confirmation" | "cancelled" | "rescheduled" | null>(
    params.get("created") && !readOnly ? "confirmation" : null,
  );
  const wa = useWhatsApp();

  return (
    <>
      <PageHeader title={t("appt.title", { ref: a.referenceCode })} back="/" />
      <div className="space-y-6">
        {suggest && (
          <Alert tone="success">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>
                {suggest === "confirmation"
                  ? t("appt.created", { ref: a.referenceCode })
                  : t(suggest === "cancelled" ? "appt.cancelledDone" : "appt.rescheduled")}
              </span>
              <Button
                busy={wa.busy}
                onClick={async () => {
                  await wa.send(() => api.reception.appointmentMessage(a.id, suggest));
                  setSuggest(null);
                }}
              >
                {t("appt.sendWhatsApp")}
              </Button>
            </div>
          </Alert>
        )}
        {wa.error && <Alert>{wa.error}</Alert>}
        {a.status === "cancelled" && a.cancelReason && <Alert tone="info">{t("appt.cancelled", { reason: a.cancelReason })}</Alert>}
        {a.revisitFlag && a.bookingType === "revisit" && <RevisitWarning appointment={a} readOnly={readOnly} />}

        <Card
          title={a.patient.fullName}
          actions={
            <Link to={`/patients/${a.patient.id}`} className="text-sm font-semibold text-brand-700 hover:underline">
              {t("appt.openPatient")}
            </Link>
          }
        >
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <StatusBadge status={a.status} />
            {a.isOverride && (
              <span title={t("appt.overrideHint")}>
                <Badge tone="amber">{t("appt.override")}</Badge>
              </span>
            )}
          </div>
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <Item label={t("common.phone")}>
              <Phone value={a.patient.phone} />
            </Item>
            <Item label={t("appt.doctor")}>{pick(a.doctor.nameAr, a.doctor.nameEn)}</Item>
            <Item label={t("appt.date")}>
              {when.dayTime(a.startAt)} – {when.time(a.endAt)}
            </Item>
            <Item label={t("appt.type")}>{t(`booking.${a.bookingType}`)}</Item>
            <Item label={t("appt.price")}>{when.money(a.priceSnapshot)}</Item>
            <Item label={t("appt.source")}>{t(`source.${a.source}`)}</Item>
            <Item label={t("appt.reference")}>
              <span dir="ltr" className="font-mono">
                {a.referenceCode}
              </span>
            </Item>
            <Item label={t("newAppt.locale")}>{t(a.patient.preferredLocale === "ar" ? "common.arabic" : "common.english")}</Item>
          </dl>
          {a.patientNote && (
            <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm">
              <p className="mb-1 font-medium">{t("appt.patientNote")}</p>
              <p className="whitespace-pre-wrap text-slate-700">{a.patientNote}</p>
            </div>
          )}
          {!readOnly && <StatusButtons appointment={a} onCancel={() => setCancelling(true)} onReschedule={() => setRescheduling(true)} />}
        </Card>

        {!readOnly && <WhatsAppCard key={`${a.status}-${a.startAt}`} data={data} wa={wa} />}
        <NoteCard appointment={a} readOnly={readOnly} />
        <HistoryCards data={data} />
      </div>

      {cancelling && (
        <CancelModal
          appointment={a}
          onClose={() => setCancelling(false)}
          onDone={() => {
            setCancelling(false);
            setSuggest("cancelled");
          }}
        />
      )}
      {rescheduling && (
        <RescheduleModal
          appointment={a}
          onClose={() => setRescheduling(false)}
          onDone={() => {
            setRescheduling(false);
            setSuggest("rescheduled");
          }}
        />
      )}
    </>
  );
}

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}

// ---------------------------------------------------------------- actions

function StatusButtons({
  appointment: a,
  onCancel,
  onReschedule,
}: {
  appointment: Appointment;
  onCancel: () => void;
  onReschedule: () => void;
}) {
  const { t } = useI18n();
  const errorText = useErrorText();
  const status = useStatusAction();
  const actions = availableActions(a.status);
  const canMove = ["pending", "confirmed", "checked_in"].includes(a.status);
  return (
    <div className="mt-5 border-t border-slate-100 pt-4">
      <div className="flex flex-wrap gap-2">
        {actions
          .filter((x) => x !== "cancel")
          .map((action) => (
            <Button
              key={action}
              variant={action === "no_show" ? "danger" : action === "reopen" ? "secondary" : "primary"}
              disabled={status.isPending}
              onClick={() => status.mutate({ id: a.id, action })}
            >
              {t(`action.${action}`)}
            </Button>
          ))}
        {canMove && (
          <Button variant="secondary" onClick={onReschedule}>
            {t("appt.reschedule")}
          </Button>
        )}
        {actions.includes("cancel") && (
          <Button variant="danger" onClick={onCancel}>
            {t("action.cancel")}
          </Button>
        )}
      </div>
      {status.error && (
        <div className="mt-3">
          <Alert>{errorText(status.error).message}</Alert>
        </div>
      )}
    </div>
  );
}

function RevisitWarning({ appointment: a, readOnly }: { appointment: Appointment; readOnly: boolean }) {
  const { t } = useI18n();
  const errorText = useErrorText();
  const invalidate = useInvalidateReception();
  const change = useMutation({
    mutationFn: () =>
      api.reception.reschedule(a.id, { startAt: new Date(a.startAt).getTime(), bookingType: "visit", override: a.isOverride }),
    onSuccess: invalidate,
  });
  return (
    <Alert tone="warning">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>{t("appt.revisitFlag")}</span>
        {!readOnly && (
          <Button variant="secondary" busy={change.isPending} onClick={() => change.mutate()}>
            {t("appt.makeVisit")}
          </Button>
        )}
      </div>
      {change.error && <p className="mt-2 text-red-700">{errorText(change.error).message}</p>}
    </Alert>
  );
}

function RescheduleModal({ appointment: a, onClose, onDone }: { appointment: Appointment; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const when = useWhen();
  const errorText = useErrorText();
  const invalidate = useInvalidateReception();
  const doctors = useDoctors();
  const doctor = doctors.data?.doctors.find((d) => d.id === a.doctor.id);
  const types = doctor?.services.filter((s) => s.isActive).map((s) => s.bookingType) ?? [a.bookingType];
  const [bookingType, setBookingType] = useState<BookingType>(a.bookingType);
  const [choice, setChoice] = useState<SlotChoice | null>(null);
  const [forceOverride, setForceOverride] = useState(false);

  const move = useMutation({
    mutationFn: (c: SlotChoice) =>
      api.reception.reschedule(a.id, { startAt: c.startAt, bookingType, override: c.override || forceOverride }),
    onSuccess: async () => {
      await invalidate();
      onDone();
    },
  });
  const err = move.error ? errorText(move.error) : null;
  const canForce = move.error instanceof ApiRequestError && (move.error.code === "slot_taken" || move.error.code === "outside_session");

  return (
    <Modal open onClose={onClose} title={t("appt.rescheduleTitle")}>
      <div className="space-y-4">
        <p className="text-sm text-slate-600">{when.dayTime(a.startAt)}</p>
        <SelectField
          label={t("appt.type")}
          value={bookingType}
          onChange={(e) => {
            setBookingType(e.target.value as BookingType);
            setChoice(null);
          }}
        >
          {types.map((bt) => (
            <option key={bt} value={bt}>
              {t(`booking.${bt}`)}
            </option>
          ))}
        </SelectField>
        <SlotPicker
          key={bookingType}
          doctorId={a.doctor.id}
          bookingType={bookingType}
          initialDate={zonedParts(new Date(a.startAt).getTime(), when.timeZone).date}
          value={choice}
          onChange={(c) => {
            setChoice(c);
            setForceOverride(false);
            move.reset();
          }}
        />
        {err?.message && <Alert>{err.message}</Alert>}
        {canForce && !forceOverride && (
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={forceOverride} onChange={(e) => setForceOverride(e.target.checked)} />
            <span>
              {t("newAppt.bookAnyway")} — {t("newAppt.overrideWarning")}
            </span>
          </label>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t("common.close")}
          </Button>
          <Button disabled={!choice} busy={move.isPending} onClick={() => choice && move.mutate(choice)}>
            {t("appt.reschedule")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- WhatsApp

function defaultTemplate(a: Appointment): MessageTemplateKey {
  if (a.status === "cancelled") return "cancelled";
  if (a.status === "confirmed" && new Date(a.startAt).getTime() - Date.now() < 36 * 3_600_000) return "reminder";
  return "confirmation";
}

function WhatsAppCard({ data, wa }: { data: AppointmentDetail; wa: ReturnType<typeof useWhatsApp> }) {
  const { t } = useI18n();
  const when = useWhen();
  const a = data.appointment;
  const [template, setTemplate] = useState<MessageTemplateKey>(defaultTemplate(a));
  const keys = MESSAGE_TEMPLATE_KEYS.filter((k) => k !== "request_followup");

  return (
    <Card title={t("appt.messages")}>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-48 flex-1">
          <SelectField label={t("appt.template")} value={template} onChange={(e) => setTemplate(e.target.value as MessageTemplateKey)}>
            {keys.map((k) => (
              <option key={k} value={k}>
                {t(`templates.${k}`)}
              </option>
            ))}
          </SelectField>
        </div>
        <Button busy={wa.busy} onClick={() => wa.send(() => api.reception.appointmentMessage(a.id, template))}>
          {t("appt.sendWhatsApp")}
        </Button>
      </div>
      <div className="mt-4">
        {data.messages.length === 0 ? (
          <p className="text-sm text-slate-500">{t("appt.messagesEmpty")}</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {data.messages.map((m) => (
              <li key={m.id} className="flex flex-wrap gap-x-2">
                <span className="font-medium">{t(`templates.${m.templateKey}`)}</span>
                <span className="text-slate-500">
                  {when.dayTime(m.sentAt)}
                  {m.sentBy && ` · ${t("appt.by", { name: m.sentBy })}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- note and history

function NoteCard({ appointment: a, readOnly }: { appointment: Appointment; readOnly: boolean }) {
  const { t } = useI18n();
  const errorText = useErrorText();
  const invalidate = useInvalidateReception();
  const [note, setNote] = useState(a.internalNote ?? "");
  const [flash, setFlash] = useFlash();
  const save = useMutation({
    mutationFn: () => api.reception.updateAppointment(a.id, { internalNote: note.trim() || null }),
    onSuccess: async () => {
      await invalidate();
      setFlash(t("common.saved"));
    },
  });
  if (readOnly) {
    return a.internalNote ? (
      <Card title={t("appt.internalNote")}>
        <p className="whitespace-pre-wrap text-sm">{a.internalNote}</p>
      </Card>
    ) : null;
  }
  return (
    <Card title={t("appt.internalNote")}>
      <div className="space-y-3">
        <TextAreaField
          label={t("appt.internalNote")}
          hint={t("appt.notesHint")}
          rows={3}
          maxLength={1000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <div className="flex items-center gap-3">
          <Button variant="secondary" busy={save.isPending} disabled={note === (a.internalNote ?? "")} onClick={() => save.mutate()}>
            {t("appt.saveNote")}
          </Button>
          {flash && <span className="text-sm text-emerald-700">{flash}</span>}
          {save.error && <span className="text-sm text-red-600">{errorText(save.error).message}</span>}
        </div>
      </div>
    </Card>
  );
}

function HistoryCards({ data }: { data: AppointmentDetail }) {
  const { t, tx, pick } = useI18n();
  const when = useWhen();
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card title={t("appt.history")}>
        {data.history.length === 0 ? (
          <Empty />
        ) : (
          <ol className="space-y-2 text-sm">
            {data.history.map((h) => (
              <li key={h.id} className="flex flex-wrap gap-x-2">
                <span className="font-medium">{tx(`audit.${h.action}`, h.action)}</span>
                <span className="text-slate-500">
                  {when.dayTime(h.at)}
                  {h.userName && ` · ${h.userName}`}
                </span>
                {h.isSupportAction && <Badge tone="amber">{t("activity.supportTag")}</Badge>}
              </li>
            ))}
          </ol>
        )}
      </Card>
      <Card title={t("appt.patientHistory")}>
        {data.patientHistory.length === 0 ? (
          <Empty />
        ) : (
          <ul className="space-y-2 text-sm">
            {data.patientHistory.map((p) => (
              <li key={p.id}>
                <Link to={`/appointments/${p.id}`} className="flex flex-wrap items-center gap-2 hover:underline">
                  <span className="tabular-nums">{when.dayTime(p.startAt)}</span>
                  <span className="text-slate-500">{pick(p.doctor.nameAr, p.doctor.nameEn)}</span>
                  <StatusBadge status={p.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
