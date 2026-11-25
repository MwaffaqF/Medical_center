import { useMutation, useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import type { Locale, SessionUser } from "@mc/shared";
import { api } from "../../api";
import { useI18n } from "../../i18n";
import { Phone, RECEPTION, StatusBadge, useInvalidateReception, useWhen } from "../../reception";
import type { Patient } from "../../types";
import {
  Alert,
  Badge,
  Button,
  Card,
  Empty,
  Grid2,
  Loading,
  Modal,
  PageHeader,
  SelectField,
  TextAreaField,
  TextField,
  useErrorText,
  useFlash,
} from "../../ui";
import { useDebounced } from "./NewAppointment";

/** Patients (spec §11.6): search by name or phone. */
export function PatientsPage() {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const query = useDebounced(q.trim(), 300);
  const patients = useQuery({ queryKey: [RECEPTION, "patients", query], queryFn: () => api.reception.patients(query) });

  return (
    <>
      <PageHeader title={t("patients.title")} />
      <div className="mb-4 max-w-md">
        <TextField
          label={t("common.search")}
          hint={t("patients.searchHint")}
          type="search"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setParams(e.target.value ? { q: e.target.value } : {}, { replace: true });
          }}
        />
      </div>
      {patients.isPending ? (
        <Loading />
      ) : !patients.data?.patients.length ? (
        <Empty />
      ) : (
        <ul className="divide-y divide-slate-100 rounded-2xl bg-white ring-1 ring-slate-200">
          {patients.data.patients.map((p) => (
            <li key={p.id}>
              <Link to={`/patients/${p.id}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-slate-50">
                <div className="min-w-0">
                  <p className="truncate font-medium">{p.fullName}</p>
                  <p dir="ltr" className="text-start text-sm text-slate-500">
                    {p.phone}
                  </p>
                </div>
                <Counts patient={p} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function Counts({ patient: p }: { patient: Pick<Patient, "total" | "completed" | "noShow"> }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap gap-1">
      <Badge>
        {t("patients.total")}: {p.total}
      </Badge>
      <Badge tone="green">
        {t("patients.completed")}: {p.completed}
      </Badge>
      {p.noShow > 0 && (
        <Badge tone="red">
          {t("patients.noShows")}: {p.noShow}
        </Badge>
      )}
    </div>
  );
}

/** Patient profile: contact details, administrative notes, history, merge (manager). */
export function PatientPage({ user }: { user: SessionUser }) {
  const { id } = useParams();
  const { t, pick } = useI18n();
  const when = useWhen();
  const detail = useQuery({ queryKey: [RECEPTION, "patient", id], queryFn: () => api.reception.patient(id!) });
  const [merging, setMerging] = useState(false);
  const readOnly = user.role === "doctor";
  const canMerge = user.role === "manager" || user.role === "super_admin";

  if (detail.isPending) return <Loading />;
  if (detail.error) {
    return (
      <>
        <PageHeader title={t("patients.title")} back="/patients" />
        <Alert>{t("error.not_found")}</Alert>
      </>
    );
  }
  const { patient, appointments, requests } = detail.data;

  return (
    <>
      <PageHeader
        title={patient.fullName}
        back="/patients"
        actions={
          !readOnly && (
            <Link
              to={`/appointments/new?patient=${patient.id}`}
              className="inline-flex items-center rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800"
            >
              + {t("appt.new")}
            </Link>
          )
        }
      />
      <div className="space-y-6">
        <div className="flex flex-wrap items-center gap-3">
          <Phone value={patient.phone} />
          <Counts patient={patient} />
        </div>
        {readOnly ? null : <PatientForm key={patient.id} patient={patient} />}

        <Card title={t("patients.history")}>
          {appointments.length === 0 ? (
            <Empty />
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {appointments.map((a) => (
                <li key={a.id}>
                  <Link to={`/appointments/${a.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 hover:underline">
                    <span className="w-44 tabular-nums">{when.dayTime(a.startAt)}</span>
                    <span className="flex-1">
                      {pick(a.doctor.nameAr, a.doctor.nameEn)} · {t(`booking.${a.bookingType}`)}
                    </span>
                    <StatusBadge status={a.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {requests.length > 0 && (
          <Card title={t("patients.requests")}>
            <ul className="space-y-1 text-sm">
              {requests.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-2">
                  <span dir="ltr" className="font-mono">
                    {r.referenceCode}
                  </span>
                  <span className="text-slate-500">{when.dayTime(r.createdAt)}</span>
                  <Badge>{t(`requestStatus.${r.status}`)}</Badge>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {canMerge && (
          <Card title={t("patients.merge")}>
            <p className="mb-3 text-sm text-slate-600">{t("patients.mergeIntro")}</p>
            <Button variant="secondary" onClick={() => setMerging(true)}>
              {t("patients.merge")}
            </Button>
          </Card>
        )}
      </div>
      {merging && <MergeModal patient={patient} onClose={() => setMerging(false)} />}
    </>
  );
}

function PatientForm({ patient }: { patient: Patient }) {
  const { t } = useI18n();
  const errorText = useErrorText();
  const invalidate = useInvalidateReception();
  const [flash, setFlash] = useFlash();
  const [form, setForm] = useState(() => toForm(patient));
  const save = useMutation({
    mutationFn: () =>
      api.reception.updatePatient(patient.id, {
        fullName: form.fullName,
        phone: form.phone,
        preferredLocale: form.preferredLocale,
        gender: (form.gender || null) as Patient["gender"],
        dateOfBirth: form.dateOfBirth || null,
        notes: form.notes.trim() || null,
      }),
    onSuccess: async (res) => {
      setForm(toForm(res.patient)); // shows the phone as stored (+963…)
      await invalidate();
      setFlash(t("common.saved"));
    },
  });
  const err = save.error ? errorText(save.error) : null;
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }

  return (
    <Card title={t("patients.details")}>
      <form onSubmit={submit} className="space-y-4">
        <Grid2>
          <TextField
            label={t("newAppt.patientName")}
            value={form.fullName}
            onChange={set("fullName")}
            maxLength={120}
            required
            error={err?.fields.fullName}
          />
          <TextField
            label={t("common.phone")}
            type="tel"
            dir="ltr"
            value={form.phone}
            onChange={set("phone")}
            required
            error={err?.fields.phone}
          />
          <SelectField
            label={t("newAppt.locale")}
            value={form.preferredLocale}
            onChange={(e) => setForm({ ...form, preferredLocale: e.target.value as Locale })}
          >
            <option value="ar">{t("common.arabic")}</option>
            <option value="en">{t("common.english")}</option>
          </SelectField>
          <SelectField label={t("patients.gender")} optional value={form.gender} onChange={set("gender")}>
            <option value="">—</option>
            <option value="male">{t("doctors.gender.male")}</option>
            <option value="female">{t("doctors.gender.female")}</option>
          </SelectField>
          <TextField
            label={t("patients.dob")}
            optional
            type="date"
            value={form.dateOfBirth}
            onChange={set("dateOfBirth")}
            error={err?.fields.dateOfBirth}
          />
        </Grid2>
        <TextAreaField
          label={t("patients.notes")}
          hint={t("appt.notesHint")}
          optional
          rows={3}
          maxLength={1000}
          value={form.notes}
          onChange={set("notes")}
        />
        {err?.message && <Alert>{err.message}</Alert>}
        <div className="flex items-center gap-3">
          <Button type="submit" busy={save.isPending}>
            {t("common.save")}
          </Button>
          {flash && <span className="text-sm text-emerald-700">{flash}</span>}
        </div>
      </form>
    </Card>
  );
}

const toForm = (p: Pick<Patient, "fullName" | "phone" | "preferredLocale" | "gender" | "dateOfBirth" | "notes">) => ({
  fullName: p.fullName,
  phone: p.phone,
  preferredLocale: p.preferredLocale,
  gender: p.gender ?? "",
  dateOfBirth: p.dateOfBirth ?? "",
  notes: p.notes ?? "",
});

function MergeModal({ patient, onClose }: { patient: Patient; onClose: () => void }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const errorText = useErrorText();
  const invalidate = useInvalidateReception();
  const [q, setQ] = useState(patient.phone.slice(-7));
  const query = useDebounced(q.trim(), 300);
  const results = useQuery({
    queryKey: [RECEPTION, "patients", query],
    queryFn: () => api.reception.patients(query),
    enabled: query.length >= 2,
  });
  const merge = useMutation({
    mutationFn: (intoId: string) => api.reception.mergePatient(patient.id, intoId),
    onSuccess: async ({ patientId }) => {
      await invalidate();
      navigate(`/patients/${patientId}`, { replace: true });
    },
  });
  const candidates = (results.data?.patients ?? []).filter((p) => p.id !== patient.id);

  return (
    <Modal open onClose={onClose} title={t("patients.merge")}>
      <div className="space-y-4">
        <p className="text-sm text-slate-600">{t("patients.mergeIntro")}</p>
        <TextField label={t("common.search")} type="search" value={q} onChange={(e) => setQ(e.target.value)} />
        {results.isFetching && !results.data ? (
          <Loading />
        ) : candidates.length === 0 ? (
          <Empty />
        ) : (
          <ul className="max-h-64 divide-y divide-slate-100 overflow-y-auto rounded-xl ring-1 ring-slate-200">
            {candidates.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <div>
                  <p className="font-medium">{p.fullName}</p>
                  <p dir="ltr" className="text-start text-sm text-slate-500">
                    {p.phone} · {p.total}
                  </p>
                </div>
                <Button
                  variant="secondary"
                  disabled={merge.isPending}
                  onClick={() =>
                    window.confirm(t("patients.mergeConfirm", { from: patient.fullName, into: p.fullName })) && merge.mutate(p.id)
                  }
                >
                  {t("patients.merge")}
                </Button>
              </li>
            ))}
          </ul>
        )}
        {merge.error && <Alert>{errorText(merge.error).message}</Alert>}
        <div className="flex justify-end">
          <Button variant="secondary" onClick={onClose}>
            {t("common.close")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
