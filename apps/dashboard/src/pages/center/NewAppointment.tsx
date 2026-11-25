import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { normalizePhone, zonedToUtc, type BookingType, type Locale } from "@mc/shared";
import { api, ApiRequestError } from "../../api";
import { useI18n } from "../../i18n";
import { Phone, RECEPTION, useDoctors, useInvalidateReception, useWhen } from "../../reception";
import { SlotPicker, type SlotChoice } from "../../slot-picker";
import type { BookingRequest, Patient, PatientRef } from "../../types";
import { Alert, Button, Card, Loading, PageHeader, SelectField, TextAreaField, TextField, useErrorText } from "../../ui";

type Source = "phone" | "whatsapp" | "walk_in";
type NewPatient = { fullName: string; phone: string; preferredLocale: Locale };

/**
 * New appointment by reception (spec §11.4). Also used to convert a booking request
 * (`?request=<id>`) and to book from an empty calendar slot (`?doctor=&date=&time=`).
 */
export function NewAppointmentPage() {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const requestId = params.get("request");
  const requests = useQuery({
    queryKey: [RECEPTION, "requests", "all"],
    queryFn: () => api.reception.requests(),
    enabled: !!requestId,
  });
  const patientId = params.get("patient");
  const patientQuery = useQuery({
    queryKey: [RECEPTION, "patient", patientId],
    queryFn: () => api.reception.patient(patientId!),
    enabled: !!patientId,
  });
  if ((requestId && requests.isPending) || (patientId && patientQuery.isPending)) return <Loading />;
  const request = requestId ? requests.data?.requests.find((r) => r.id === requestId) : undefined;
  return (
    <>
      <PageHeader title={t("appt.new")} back={request ? "/requests" : "/"} />
      {requestId && !request ? (
        <Alert>{t("error.not_found")}</Alert>
      ) : (
        <BookingForm
          request={request}
          initialPatient={patientQuery.data?.patient}
          doctorParam={params.get("doctor")}
          dateParam={params.get("date")}
          timeParam={params.get("time")}
        />
      )}
    </>
  );
}

function BookingForm({
  request,
  initialPatient,
  doctorParam,
  dateParam,
  timeParam,
}: {
  request?: BookingRequest;
  initialPatient?: PatientRef;
  doctorParam: string | null;
  dateParam: string | null;
  timeParam: string | null;
}) {
  const { t, pick } = useI18n();
  const when = useWhen();
  const navigate = useNavigate();
  const errorText = useErrorText();
  const invalidate = useInvalidateReception();
  const doctors = useDoctors();
  const bookable = (doctors.data?.doctors ?? []).filter((d) => d.isActive);

  const [patient, setPatient] = useState<PatientRef | null>(request?.patient ?? initialPatient ?? null);
  const [newPatient, setNewPatient] = useState<NewPatient | null>(null);
  const [doctorId, setDoctorId] = useState(request?.doctor.id ?? doctorParam ?? "");
  const doctor = bookable.find((d) => d.id === doctorId);
  const services = doctor?.services.filter((s) => s.isActive) ?? [];
  const [bookingType, setBookingType] = useState<BookingType | "">(request?.bookingType ?? "");
  const [choice, setChoice] = useState<SlotChoice | null>(
    dateParam && timeParam ? { startAt: zonedToUtc(dateParam, timeParam, when.timeZone), override: false } : null,
  );
  const [source, setSource] = useState<Source>(request ? "whatsapp" : "phone");
  const [checkInNow, setCheckInNow] = useState(true);
  const [note, setNote] = useState("");
  const [forceOverride, setForceOverride] = useState(false);

  // Pick the first booking type the doctor offers, keeping the requested one when possible.
  useEffect(() => {
    if (!doctor) return;
    if (!bookingType || !services.some((s) => s.bookingType === bookingType)) setBookingType(services[0]?.bookingType ?? "");
  }, [doctor, services, bookingType]);

  const book = useMutation({
    mutationFn: () =>
      api.reception.createAppointment({
        ...(patient ? { patientId: patient.id } : { newPatient: newPatient! }),
        doctorId,
        bookingType: bookingType as BookingType,
        startAt: choice!.startAt,
        source,
        status: source === "walk_in" && checkInNow ? "checked_in" : "confirmed",
        override: choice!.override || forceOverride,
        internalNote: note.trim() || null,
        requestId: request?.id,
      }),
    onSuccess: async ({ appointment }) => {
      await invalidate();
      navigate(`/appointments/${appointment.id}?created=1`, { replace: true });
    },
  });
  const err = book.error ? errorText(book.error) : null;
  const canForce = book.error instanceof ApiRequestError && (book.error.code === "slot_taken" || book.error.code === "outside_session");
  const patientReady = !!patient || (!!newPatient && newPatient.fullName.trim().length >= 2 && !!normalizePhone(newPatient.phone));
  const ready = patientReady && !!doctor && !!bookingType && !!choice;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (ready) book.mutate();
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      {request && (
        <Alert tone="info">
          {t("newAppt.fromRequest", { ref: request.referenceCode })}
          {" · "}
          {t("newAppt.preferred", {
            when: `${request.preferredDate ? when.date(request.preferredDate) : ""} ${t(`period.${request.preferredPeriod}`)}`.trim(),
          })}
          {request.patientNote && <span className="mt-1 block">“{request.patientNote}”</span>}
        </Alert>
      )}

      <Step n={1} title={t("newAppt.stepPatient")}>
        {patient ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-medium">{patient.fullName}</p>
              <Phone value={patient.phone} />
            </div>
            {!request && (
              <Button variant="ghost" onClick={() => setPatient(null)}>
                {t("newAppt.change")}
              </Button>
            )}
          </div>
        ) : (
          <PatientChooser
            newPatient={newPatient}
            onNewPatient={setNewPatient}
            onPick={(p) => {
              setPatient(p);
              setNewPatient(null);
            }}
            errors={err?.fields}
          />
        )}
      </Step>

      <Step n={2} title={t("newAppt.stepTime")}>
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            label={t("appt.doctor")}
            value={doctorId}
            onChange={(e) => {
              setDoctorId(e.target.value);
              setChoice(null);
            }}
          >
            <option value="">{t("newAppt.chooseDoctor")}</option>
            {bookable.map((d) => (
              <option key={d.id} value={d.id}>
                {pick(d.nameAr, d.nameEn)}
              </option>
            ))}
          </SelectField>
          {doctor && services.length > 0 && (
            <SelectField
              label={t("appt.type")}
              value={bookingType}
              onChange={(e) => {
                setBookingType(e.target.value as BookingType);
                setChoice(null);
              }}
            >
              {services.map((s) => (
                <option key={s.bookingType} value={s.bookingType}>
                  {t(`booking.${s.bookingType}`)} · {s.durationMinutes} {t("common.minutes")} · {when.money(s.price)}
                </option>
              ))}
            </SelectField>
          )}
        </div>
        {doctor && services.length === 0 && (
          <div className="mt-3">
            <Alert tone="warning">{t("newAppt.noServices")}</Alert>
          </div>
        )}
        {doctor && bookingType && (
          <div className="mt-4">
            <SlotPicker
              key={`${doctorId}-${bookingType}`}
              doctorId={doctorId}
              bookingType={bookingType}
              initialDate={dateParam ?? request?.preferredDate ?? undefined}
              value={choice}
              onChange={(c) => {
                setChoice(c);
                setForceOverride(false);
                book.reset();
              }}
            />
          </div>
        )}
        {choice && (
          <p className="mt-3 text-sm font-medium text-brand-800">{t("newAppt.selected", { when: when.dayTime(choice.startAt) })}</p>
        )}
      </Step>

      <Step n={3} title={t("newAppt.stepDetails")}>
        <div className="space-y-4">
          <fieldset>
            <legend className="mb-2 text-sm font-medium">{t("appt.source")}</legend>
            <div className="flex flex-wrap gap-2">
              {(["phone", "whatsapp", "walk_in"] as const).map((s) => (
                <label
                  key={s}
                  className={`cursor-pointer rounded-lg px-3 py-2 text-sm ring-1 ${source === s ? "bg-brand-50 font-semibold text-brand-800 ring-brand-600" : "ring-slate-300"}`}
                >
                  <input type="radio" name="source" className="sr-only" checked={source === s} onChange={() => setSource(s)} />
                  {t(`source.${s}`)}
                </label>
              ))}
            </div>
          </fieldset>
          {source === "walk_in" && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={checkInNow} onChange={(e) => setCheckInNow(e.target.checked)} />
              {t("newAppt.checkInNow")}
            </label>
          )}
          <TextAreaField
            label={t("appt.internalNote")}
            hint={t("appt.notesHint")}
            optional
            rows={2}
            maxLength={1000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
      </Step>

      {err?.message && <Alert>{err.message}</Alert>}
      {canForce && (
        <label className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm ring-1 ring-amber-200">
          <input type="checkbox" className="mt-1" checked={forceOverride} onChange={(e) => setForceOverride(e.target.checked)} />
          <span>
            <span className="font-semibold">{t("newAppt.bookAnyway")}</span> — {t("newAppt.overrideWarning")}
          </span>
        </label>
      )}
      <div className="flex justify-end">
        <Button type="submit" disabled={!ready || (canForce && !forceOverride)} busy={book.isPending}>
          {t("newAppt.submit")}
        </Button>
      </div>
    </form>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <Card>
      <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
        <span className="flex size-7 items-center justify-center rounded-full bg-brand-700 text-sm text-white">{n}</span>
        {title}
      </h2>
      {children}
    </Card>
  );
}

/** Search by phone or name; pick a match or fill in a new patient inline. */
function PatientChooser({
  newPatient,
  onNewPatient,
  onPick,
  errors = {},
}: {
  newPatient: NewPatient | null;
  onNewPatient: (p: NewPatient | null) => void;
  onPick: (p: PatientRef) => void;
  errors?: Record<string, string>;
}) {
  const { t, locale } = useI18n();
  const [q, setQ] = useState("");
  const query = useDebounced(q.trim(), 300);
  const results = useQuery({
    queryKey: [RECEPTION, "patients", query],
    queryFn: () => api.reception.patients(query),
    enabled: query.length >= 2,
  });

  if (newPatient) {
    const phoneValid = !newPatient.phone || !!normalizePhone(newPatient.phone);
    return (
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label={t("newAppt.patientName")}
            value={newPatient.fullName}
            onChange={(e) => onNewPatient({ ...newPatient, fullName: e.target.value })}
            maxLength={120}
            required
            autoFocus
            error={errors["newPatient.fullName"] ? t("field.required") : undefined}
          />
          <TextField
            label={t("common.phone")}
            type="tel"
            dir="ltr"
            inputMode="tel"
            placeholder="09XXXXXXXX"
            value={newPatient.phone}
            onChange={(e) => onNewPatient({ ...newPatient, phone: e.target.value })}
            required
            error={!phoneValid || errors["newPatient.phone"] ? t("field.invalid_phone") : undefined}
          />
          <SelectField
            label={t("newAppt.locale")}
            value={newPatient.preferredLocale}
            onChange={(e) => onNewPatient({ ...newPatient, preferredLocale: e.target.value as Locale })}
          >
            <option value="ar">{t("common.arabic")}</option>
            <option value="en">{t("common.english")}</option>
          </SelectField>
        </div>
        <Button variant="ghost" className="!px-0" onClick={() => onNewPatient(null)}>
          {t("common.back")}
        </Button>
      </div>
    );
  }

  const looksLikePhone = /^[+\d\s-]{6,}$/.test(q.trim());
  return (
    <div className="space-y-3">
      <TextField
        label={t("newAppt.search")}
        hint={t("patients.searchHint")}
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        autoFocus
      />
      {query.length >= 2 &&
        (results.isPending ? (
          <Loading />
        ) : (
          <ul className="divide-y divide-slate-100 rounded-xl ring-1 ring-slate-200">
            {(results.data?.patients ?? []).map((p: Patient) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => onPick(p)}
                  className="flex w-full flex-wrap items-center justify-between gap-2 px-3 py-2 text-start hover:bg-slate-50"
                >
                  <span className="font-medium">{p.fullName}</span>
                  <span dir="ltr" className="text-sm text-slate-500">
                    {p.phone}
                  </span>
                </button>
              </li>
            ))}
            {results.data?.patients.length === 0 && <li className="px-3 py-3 text-sm text-slate-500">{t("newAppt.noMatch")}</li>}
          </ul>
        ))}
      <Button
        variant="secondary"
        onClick={() =>
          onNewPatient({ fullName: looksLikePhone ? "" : q.trim(), phone: looksLikePhone ? q.trim() : "", preferredLocale: locale })
        }
      >
        + {t("newAppt.newPatient")}
      </Button>
    </div>
  );
}

export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return v;
}
