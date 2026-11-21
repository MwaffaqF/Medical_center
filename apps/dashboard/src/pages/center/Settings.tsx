import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type FormEvent } from "react";
import { SLOT_STEPS } from "@mc/shared";
import { api } from "../../api";
import { useI18n } from "../../i18n";
import { resizeImage } from "../../image";
import type { Center } from "../../types";
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
  useErrorText,
  useFlash,
  type FormErrors,
} from "../../ui";

const KEY = ["center", "settings"];

export function SettingsPage() {
  const { t } = useI18n();
  const settings = useQuery({ queryKey: KEY, queryFn: api.center.settings });
  if (settings.isPending) return <Loading />;
  if (!settings.data) return <Alert>{t("error.generic")}</Alert>;
  return (
    <>
      <PageHeader title={t("settings.title")} />
      <div className="space-y-6">
        <LogoCard center={settings.data.center} />
        <SettingsForm center={settings.data.center} />
      </div>
    </>
  );
}

function SettingsForm({ center }: { center: Center }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const errorText = useErrorText();
  const [flash, setFlash] = useFlash();
  const [errors, setErrors] = useState<FormErrors>(NO_ERRORS);
  const [form, setForm] = useState({
    nameAr: center.nameAr,
    nameEn: center.nameEn,
    phone: center.phone ?? "",
    whatsappPhone: center.whatsappPhone ?? "",
    addressAr: center.addressAr ?? "",
    addressEn: center.addressEn ?? "",
    mapUrl: center.mapUrl ?? "",
    openingHoursAr: center.openingHoursAr ?? "",
    openingHoursEn: center.openingHoursEn ?? "",
    aboutAr: center.aboutAr ?? "",
    aboutEn: center.aboutEn ?? "",
    defaultLocale: center.defaultLocale,
    slotStepMinutes: center.slotStepMinutes,
    minLeadMinutes: center.minLeadMinutes,
    maxAdvanceDays: center.maxAdvanceDays,
  });
  type TextKey = Exclude<keyof typeof form, "defaultLocale" | "slotStepMinutes" | "minLeadMinutes" | "maxAdvanceDays">;
  const set = (k: TextKey) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = useMutation({
    mutationFn: () => api.center.updateSettings(form),
    onSuccess: ({ center: saved }) => {
      qc.setQueryData(KEY, { center: saved });
      setErrors(NO_ERRORS);
      setFlash(t("common.saved"));
    },
    onError: (e) => setErrors(errorText(e)),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <Card title={t("settings.info")}>
        <div className="space-y-4">
          <Grid2>
            <TextField label={t("centers.nameAr")} dir="rtl" required value={form.nameAr} onChange={set("nameAr")} error={errors.fields.nameAr} />
            <TextField label={t("centers.nameEn")} dir="ltr" required value={form.nameEn} onChange={set("nameEn")} error={errors.fields.nameEn} />
          </Grid2>
          <TextAreaField label={t("settings.aboutAr")} dir="rtl" optional value={form.aboutAr} onChange={set("aboutAr")} />
          <TextAreaField label={t("settings.aboutEn")} dir="ltr" optional value={form.aboutEn} onChange={set("aboutEn")} />
          <Grid2>
            <TextAreaField label={t("settings.hoursAr")} dir="rtl" rows={3} optional value={form.openingHoursAr} onChange={set("openingHoursAr")} />
            <TextAreaField label={t("settings.hoursEn")} dir="ltr" rows={3} optional value={form.openingHoursEn} onChange={set("openingHoursEn")} />
          </Grid2>
        </div>
      </Card>

      <Card title={t("settings.contact")}>
        <div className="space-y-4">
          <Grid2>
            <TextField label={t("common.phone")} type="tel" dir="ltr" optional value={form.phone} onChange={set("phone")} error={errors.fields.phone} />
            <TextField
              label={t("centers.whatsapp")}
              type="tel"
              dir="ltr"
              optional
              placeholder="09XX XXX XXX"
              value={form.whatsappPhone}
              onChange={set("whatsappPhone")}
              error={errors.fields.whatsappPhone}
            />
            <TextField label={t("settings.addressAr")} dir="rtl" optional value={form.addressAr} onChange={set("addressAr")} />
            <TextField label={t("settings.addressEn")} dir="ltr" optional value={form.addressEn} onChange={set("addressEn")} />
          </Grid2>
          <TextField
            label={t("settings.mapUrl")}
            type="url"
            dir="ltr"
            optional
            placeholder="https://maps.app.goo.gl/…"
            value={form.mapUrl}
            onChange={set("mapUrl")}
            error={errors.fields.mapUrl}
          />
        </div>
      </Card>

      <Card title={t("settings.booking")}>
        <Grid2>
          <SelectField
            label={t("settings.slotStep")}
            value={form.slotStepMinutes}
            onChange={(e) => setForm({ ...form, slotStepMinutes: Number(e.target.value) })}
          >
            {SLOT_STEPS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </SelectField>
          <TextField
            label={t("settings.minLead")}
            type="number"
            min={0}
            max={10080}
            dir="ltr"
            value={form.minLeadMinutes}
            onChange={(e) => setForm({ ...form, minLeadMinutes: Number(e.target.value) })}
            error={errors.fields.minLeadMinutes}
          />
          <TextField
            label={t("settings.maxAdvance")}
            type="number"
            min={1}
            max={180}
            dir="ltr"
            value={form.maxAdvanceDays}
            onChange={(e) => setForm({ ...form, maxAdvanceDays: Number(e.target.value) })}
            error={errors.fields.maxAdvanceDays}
          />
          <SelectField
            label={t("settings.defaultLocale")}
            value={form.defaultLocale}
            onChange={(e) => setForm({ ...form, defaultLocale: e.target.value as "ar" | "en" })}
          >
            <option value="ar">العربية</option>
            <option value="en">English</option>
          </SelectField>
        </Grid2>
      </Card>

      <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center justify-end gap-3 border-t border-slate-200 bg-slate-50/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-xl">
        {errors.message && <span className="text-sm text-red-700">{errors.message}</span>}
        {flash && <span className="text-sm text-emerald-700">{flash}</span>}
        <Button type="submit" busy={save.isPending}>
          {t("common.save")}
        </Button>
      </div>
    </form>
  );
}

function LogoCard({ center }: { center: Center }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const errorText = useErrorText();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const upload = useMutation({
    mutationFn: async (file: File) => api.center.uploadLogo(await resizeImage(file, 512)),
    onSuccess: () => {
      setError(null);
      return qc.invalidateQueries({ queryKey: KEY });
    },
    onError: (e) => setError(errorText(e).message),
  });
  return (
    <Card title={t("settings.logo")}>
      <div className="flex flex-wrap items-center gap-4">
        {center.logoUrl ? (
          <img src={center.logoUrl} alt="" className="size-20 rounded-xl object-contain ring-1 ring-slate-200" />
        ) : (
          <img src="/icon.svg" alt="" className="size-20 opacity-40" />
        )}
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
          {t("settings.uploadLogo")}
        </Button>
      </div>
      {error && (
        <div className="mt-3">
          <Alert>{error}</Alert>
        </div>
      )}
    </Card>
  );
}
