import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { api } from "../../api";
import { useI18n } from "../../i18n";
import type { Specialty } from "../../types";
import {
  Alert,
  Badge,
  Button,
  Empty,
  Grid2,
  Loading,
  Modal,
  NO_ERRORS,
  PageHeader,
  TextAreaField,
  TextField,
  Toggle,
  useErrorText,
  type FormErrors,
} from "../../ui";

const KEY = ["center", "specialties"];

export function SpecialtiesPage() {
  const { t, pick } = useI18n();
  const list = useQuery({ queryKey: KEY, queryFn: api.center.specialties });
  const [editing, setEditing] = useState<Specialty | "new" | null>(null);

  return (
    <>
      <PageHeader title={t("specialties.title")} actions={<Button onClick={() => setEditing("new")}>{t("specialties.add")}</Button>} />
      {list.isPending ? (
        <Loading />
      ) : !list.data?.specialties.length ? (
        <Empty />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {list.data.specialties.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => setEditing(s)}
                className="block w-full rounded-2xl bg-white p-4 text-start ring-1 ring-slate-200 transition hover:ring-brand-600"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold">{pick(s.nameAr, s.nameEn)}</p>
                    <p className="text-sm text-slate-500">{pick(s.nameEn, s.nameAr)}</p>
                  </div>
                  {!s.isActive && <Badge>{t("common.inactive")}</Badge>}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
      {editing && <SpecialtyModal specialty={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function SpecialtyModal({ specialty, onClose }: { specialty: Specialty | null; onClose: () => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const errorText = useErrorText();
  const [form, setForm] = useState({
    nameAr: specialty?.nameAr ?? "",
    nameEn: specialty?.nameEn ?? "",
    descriptionAr: specialty?.descriptionAr ?? "",
    descriptionEn: specialty?.descriptionEn ?? "",
    slug: specialty?.slug ?? "",
    sortOrder: specialty?.sortOrder ?? 0,
    isActive: specialty?.isActive ?? true,
  });
  const [errors, setErrors] = useState<FormErrors>(NO_ERRORS);
  const set = (k: "nameAr" | "nameEn" | "descriptionAr" | "descriptionEn" | "slug") => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = useMutation({
    mutationFn: () => {
      const input = { ...form, slug: form.slug.trim() || undefined };
      return specialty ? api.center.updateSpecialty(specialty.id, input) : api.center.createSpecialty(input);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: KEY });
      onClose();
    },
    onError: (e) => setErrors(errorText(e)),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }

  return (
    <Modal open onClose={onClose} title={specialty ? t("common.edit") : t("specialties.add")}>
      <form onSubmit={onSubmit} className="space-y-4">
        <Grid2>
          <TextField label={t("specialties.nameAr")} dir="rtl" required value={form.nameAr} onChange={set("nameAr")} error={errors.fields.nameAr} />
          <TextField label={t("specialties.nameEn")} dir="ltr" required value={form.nameEn} onChange={set("nameEn")} error={errors.fields.nameEn} />
        </Grid2>
        <TextAreaField label={t("specialties.descriptionAr")} dir="rtl" rows={3} optional value={form.descriptionAr} onChange={set("descriptionAr")} />
        <TextAreaField label={t("specialties.descriptionEn")} dir="ltr" rows={3} optional value={form.descriptionEn} onChange={set("descriptionEn")} />
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
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" busy={save.isPending}>
            {t("common.save")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
