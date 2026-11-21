import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router";
import { BOOKING_TYPES, type BookingType } from "@mc/shared";
import { api } from "../../api";
import { useI18n } from "../../i18n";
import { resizeImage } from "../../image";
import type { Doctor, Specialty } from "../../types";
import {
  Alert,
  Button,
  Card,
  Grid2,
  Loading,
  NO_ERRORS,
  PageHeader,
  SelectField,
  TextAreaField,
  TextField,
  Toggle,
  useErrorText,
  useFlash,
  type FormErrors,
} from "../../ui";
import { Avatar } from "./Doctors";

const DOCTORS = ["center", "doctors"];

export function DoctorEditPage() {
  const { id } = useParams();
  const isNew = !id || id === "new";
  const { t, pick } = useI18n();
  const doctor = useQuery({ queryKey: [...DOCTORS, id], queryFn: () => api.center.doctor(id!), enabled: !isNew });
  const specialties = useQuery({ queryKey: ["center", "specialties"], queryFn: api.center.specialties });

  if ((!isNew && doctor.isPending) || specialties.isPending) return <Loading />;
  const d = doctor.data?.doctor ?? null;

  return (
    <>
      <PageHeader title={d ? pick(d.nameAr, d.nameEn) : t("doctors.add")} back="/doctors" />
      <div className="space-y-6">
        {d && <PhotoCard doctor={d} />}
        <ProfileForm doctor={d} specialties={specialties.data?.specialties ?? []} />
        {d && <ServicesForm doctor={d} />}
      </div>
    </>
  );
}

// ---------------------------------------------------------------- profile

function ProfileForm({ doctor, specialties }: { doctor: Doctor | null; specialties: Specialty[] }) {
  const { t, pick } = useI18n();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const errorText = useErrorText();
  const [flash, setFlash] = useFlash();
  const [errors, setErrors] = useState<FormErrors>(NO_ERRORS);
  const [form, setForm] = useState({
    nameAr: doctor?.nameAr ?? "",
    nameEn: doctor?.nameEn ?? "",
    titleAr: doctor?.titleAr ?? "",
    titleEn: doctor?.titleEn ?? "",
    bioAr: doctor?.bioAr ?? "",
    bioEn: doctor?.bioEn ?? "",
    qualificationsAr: doctor?.qualificationsAr ?? "",
    qualificationsEn: doctor?.qualificationsEn ?? "",
    gender: doctor?.gender ?? "",
    yearsExperience: doctor?.yearsExperience?.toString() ?? "",
    languages: doctor?.languages ?? ["ar"],
    slug: doctor?.slug ?? "",
    sortOrder: doctor?.sortOrder ?? 0,
    isActive: doctor?.isActive ?? true,
    specialtyIds: doctor?.specialtyIds ?? [],
    primarySpecialtyId: doctor?.primarySpecialtyId ?? null,
  });
  type TextKey = "nameAr" | "nameEn" | "titleAr" | "titleEn" | "bioAr" | "bioEn" | "qualificationsAr" | "qualificationsEn" | "slug";
  const set = (k: TextKey) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  function toggleSpecialty(sid: string, on: boolean) {
    setForm((f) => {
      const ids = on ? [...f.specialtyIds, sid] : f.specialtyIds.filter((x) => x !== sid);
      const primary = ids.includes(f.primarySpecialtyId ?? "") ? f.primarySpecialtyId : (ids[0] ?? null);
      return { ...f, specialtyIds: ids, primarySpecialtyId: primary };
    });
  }

  const save = useMutation({
    mutationFn: () => {
      const input = {
        ...form,
        gender: form.gender === "male" || form.gender === "female" ? (form.gender as "male" | "female") : null,
        yearsExperience: form.yearsExperience === "" ? null : Number(form.yearsExperience),
        slug: form.slug.trim() || undefined,
      };
      return doctor ? api.center.updateDoctor(doctor.id, input) : api.center.createDoctor(input);
    },
    onSuccess: async ({ doctor: saved }) => {
      setErrors(NO_ERRORS);
      qc.setQueryData([...DOCTORS, saved.id], { doctor: saved });
      await qc.invalidateQueries({ queryKey: DOCTORS, exact: true });
      if (!doctor) navigate(`/doctors/${saved.id}`, { replace: true });
      else setFlash(t("common.saved"));
    },
    onError: (e) => setErrors(errorText(e)),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }

  return (
    <Card title={t("doctors.profile")}>
      <form onSubmit={onSubmit} className="space-y-4">
        <Grid2>
          <TextField label={t("doctors.nameAr")} dir="rtl" required placeholder="د. " value={form.nameAr} onChange={set("nameAr")} error={errors.fields.nameAr} />
          <TextField label={t("doctors.nameEn")} dir="ltr" required placeholder="Dr. " value={form.nameEn} onChange={set("nameEn")} error={errors.fields.nameEn} />
          <TextField label={t("doctors.titleAr")} dir="rtl" optional hint={t("doctors.titleHint")} value={form.titleAr} onChange={set("titleAr")} />
          <TextField label={t("doctors.titleEn")} dir="ltr" optional value={form.titleEn} onChange={set("titleEn")} />
        </Grid2>

        <fieldset>
          <legend className="mb-2 text-sm font-medium">{t("doctors.specialties")}</legend>
          {specialties.length === 0 ? (
            <p className="text-sm text-slate-500">{t("doctors.noSpecialties")}</p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {specialties.map((s) => {
                const checked = form.specialtyIds.includes(s.id);
                return (
                  <li key={s.id} className="flex items-center justify-between gap-2 rounded-lg px-3 py-2 ring-1 ring-slate-200">
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={checked} onChange={(e) => toggleSpecialty(s.id, e.target.checked)} className="size-4 accent-brand-700" />
                      {pick(s.nameAr, s.nameEn)}
                    </label>
                    {checked && form.specialtyIds.length > 1 && (
                      <label className="flex items-center gap-1 text-xs text-slate-600">
                        <input
                          type="radio"
                          name="primary"
                          checked={form.primarySpecialtyId === s.id}
                          onChange={() => setForm((f) => ({ ...f, primarySpecialtyId: s.id }))}
                          className="accent-brand-700"
                        />
                        {t("doctors.primary")}
                      </label>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </fieldset>

        <TextAreaField label={t("doctors.bioAr")} dir="rtl" optional value={form.bioAr} onChange={set("bioAr")} />
        <TextAreaField label={t("doctors.bioEn")} dir="ltr" optional value={form.bioEn} onChange={set("bioEn")} />
        <Grid2>
          <TextAreaField label={t("doctors.qualificationsAr")} dir="rtl" rows={3} optional value={form.qualificationsAr} onChange={set("qualificationsAr")} />
          <TextAreaField label={t("doctors.qualificationsEn")} dir="ltr" rows={3} optional value={form.qualificationsEn} onChange={set("qualificationsEn")} />
        </Grid2>

        <Grid2>
          <SelectField label={t("doctors.gender")} optional value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value as "" })}>
            <option value="">—</option>
            <option value="female">{t("doctors.gender.female")}</option>
            <option value="male">{t("doctors.gender.male")}</option>
          </SelectField>
          <TextField
            label={t("doctors.years")}
            type="number"
            min={0}
            max={80}
            dir="ltr"
            optional
            value={form.yearsExperience}
            onChange={(e) => setForm({ ...form, yearsExperience: e.target.value })}
            error={errors.fields.yearsExperience}
          />
        </Grid2>

        <fieldset>
          <legend className="mb-2 text-sm font-medium">{t("doctors.languages")}</legend>
          <div className="flex flex-wrap gap-4">
            {[
              ["ar", "العربية"],
              ["en", "English"],
              ["fr", "Français"],
              ["ru", "Русский"],
              ["de", "Deutsch"],
            ].map(([code, label]) => (
              <label key={code} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4 accent-brand-700"
                  checked={form.languages.includes(code!)}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      languages: e.target.checked ? [...f.languages, code!] : f.languages.filter((l) => l !== code),
                    }))
                  }
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>

        <Grid2>
          <TextField label={t("common.slug")} dir="ltr" optional hint={t("common.slugHint")} value={form.slug} onChange={set("slug")} error={errors.fields.slug} />
          <TextField
            label={t("common.sortOrder")}
            type="number"
            min={0}
            dir="ltr"
            value={form.sortOrder}
            onChange={(e) => setForm({ ...form, sortOrder: Number(e.target.value) || 0 })}
          />
        </Grid2>
        <Toggle checked={form.isActive} onChange={(v) => setForm({ ...form, isActive: v })} label={t("common.active")} />

        {errors.message && <Alert>{errors.message}</Alert>}
        {flash && <Alert tone="success">{flash}</Alert>}
        <div className="flex justify-end">
          <Button type="submit" busy={save.isPending}>
            {doctor ? t("common.save") : t("common.create")}
          </Button>
        </div>
      </form>
    </Card>
  );
}

// ---------------------------------------------------------------- photo

function PhotoCard({ doctor }: { doctor: Doctor }) {
  const { t, pick } = useI18n();
  const qc = useQueryClient();
  const errorText = useErrorText();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: DOCTORS });

  const upload = useMutation({
    mutationFn: async (file: File) => api.center.uploadPhoto(doctor.id, await resizeImage(file)),
    onSuccess: () => {
      setError(null);
      return refresh();
    },
    onError: (e) => setError(errorText(e).message),
  });
  const remove = useMutation({ mutationFn: () => api.center.removePhoto(doctor.id), onSuccess: refresh });

  return (
    <Card title={t("doctors.photo")}>
      <div className="flex flex-wrap items-center gap-4">
        <Avatar url={doctor.photoUrl} name={pick(doctor.nameAr, doctor.nameEn)} size="size-24" />
        <div className="flex flex-wrap gap-2">
          <input
            ref={input}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) upload.mutate(file);
              e.target.value = "";
            }}
          />
          <Button variant="secondary" busy={upload.isPending} onClick={() => input.current?.click()}>
            {t("doctors.uploadPhoto")}
          </Button>
          {doctor.photoUrl && (
            <Button variant="danger" busy={remove.isPending} onClick={() => remove.mutate()}>
              {t("doctors.removePhoto")}
            </Button>
          )}
        </div>
      </div>
      {error && (
        <div className="mt-3">
          <Alert>{error}</Alert>
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- booking types

const DEFAULT_DURATION: Record<BookingType, number> = { visit: 20, revisit: 10, session: 45 };

type Row = { offered: boolean; durationMinutes: string; price: string };

function ServicesForm({ doctor }: { doctor: Doctor }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const errorText = useErrorText();
  const [flash, setFlash] = useFlash();
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<Record<BookingType, Row>>(() => {
    const byType = Object.fromEntries(doctor.services.map((s) => [s.bookingType, s]));
    const visitPrice = byType.visit?.price;
    return Object.fromEntries(
      BOOKING_TYPES.map((type) => {
        const s = byType[type];
        return [
          type,
          {
            offered: s ? s.isActive : false,
            durationMinutes: String(s?.durationMinutes ?? DEFAULT_DURATION[type]),
            // Re-visit costs the same as a visit by default (spec D5).
            price: s ? String(s.price) : type === "revisit" && visitPrice !== undefined ? String(visitPrice) : "",
          },
        ];
      }),
    ) as Record<BookingType, Row>;
  });

  const update = (type: BookingType, patch: Partial<Row>) =>
    setRows((r) => {
      const next = { ...r[type], ...patch };
      // Turning on Re-visit with no price yet: start from the visit price (same price by default, spec D5).
      if (type === "revisit" && patch.offered && !next.price && r.visit.price) next.price = r.visit.price;
      return { ...r, [type]: next };
    });

  const save = useMutation({
    mutationFn: () =>
      api.center.updateServices(doctor.id, {
        services: BOOKING_TYPES.filter((type) => rows[type].offered).map((type) => ({
          bookingType: type,
          durationMinutes: Number(rows[type].durationMinutes),
          price: Number(rows[type].price),
          isActive: true,
        })),
      }),
    onSuccess: async ({ doctor: saved }) => {
      setError(null);
      qc.setQueryData([...DOCTORS, saved.id], { doctor: saved });
      await qc.invalidateQueries({ queryKey: DOCTORS, exact: true });
      setFlash(t("common.saved"));
    },
    onError: (e) => setError(errorText(e).message),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }

  return (
    <Card title={t("doctors.services")}>
      <form onSubmit={onSubmit} className="space-y-4">
        <p className="text-sm text-slate-600">{t("doctors.servicesHint")}</p>
        <ul className="space-y-3">
          {BOOKING_TYPES.map((type) => {
            const row = rows[type];
            return (
              <li key={type} className={`rounded-xl p-3 ring-1 ${row.offered ? "ring-brand-600/40" : "ring-slate-200"}`}>
                <div className="flex flex-wrap items-end gap-4">
                  <div className="w-32">
                    <Toggle checked={row.offered} onChange={(v) => update(type, { offered: v })} label={t(`booking.${type}`)} />
                  </div>
                  {row.offered && (
                    <>
                      <div className="w-36">
                        <TextField
                          label={t("doctors.duration")}
                          type="number"
                          min={5}
                          max={480}
                          step={5}
                          dir="ltr"
                          required
                          value={row.durationMinutes}
                          onChange={(e) => update(type, { durationMinutes: e.target.value })}
                        />
                      </div>
                      <div className="w-44">
                        <TextField
                          label={`${t("doctors.price")} (${t("common.currency.SYP")})`}
                          type="number"
                          min={0}
                          dir="ltr"
                          required
                          value={row.price}
                          onChange={(e) => update(type, { price: e.target.value })}
                        />
                      </div>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        {error && <Alert>{error}</Alert>}
        {flash && <Alert tone="success">{flash}</Alert>}
        <div className="flex justify-end">
          <Button type="submit" busy={save.isPending}>
            {t("doctors.saveServices")}
          </Button>
        </div>
      </form>
    </Card>
  );
}
