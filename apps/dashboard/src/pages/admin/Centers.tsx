import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { api } from "../../api";
import { useI18n } from "../../i18n";
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
  TextField,
  useErrorText,
  useFormat,
  type FormErrors,
} from "../../ui";

export function CentersPage() {
  const { t, pick } = useI18n();
  const fmt = useFormat();
  const [creating, setCreating] = useState(false);
  const centers = useQuery({ queryKey: ["admin", "centers"], queryFn: api.admin.centers });
  const stats = useQuery({ queryKey: ["admin", "stats"], queryFn: api.admin.stats });

  return (
    <>
      <PageHeader title={t("centers.title")} actions={<Button onClick={() => setCreating(true)}>{t("centers.new")}</Button>} />

      {stats.data && (
        <div className="mb-6 grid gap-3 sm:grid-cols-3">
          {[
            [t("stats.centers"), stats.data.centers],
            [t("stats.activeUsers"), stats.data.activeUsers],
            [t("stats.recentLogins"), stats.data.usersSignedInLast7Days],
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
              <p className="text-sm text-slate-500">{label}</p>
              <p className="mt-1 text-2xl font-semibold">{fmt.number(Number(value))}</p>
            </div>
          ))}
        </div>
      )}

      {centers.isPending ? (
        <Loading />
      ) : !centers.data?.centers.length ? (
        <Empty />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {centers.data.centers.map((c) => (
            <li key={c.id}>
              <Link
                to={`/admin/centers/${c.id}`}
                className="block rounded-2xl bg-white p-4 ring-1 ring-slate-200 transition hover:ring-brand-600"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{pick(c.nameAr, c.nameEn)}</p>
                    <p dir="ltr" className="text-start text-sm text-slate-500">
                      {c.slug}
                    </p>
                  </div>
                  <Badge tone={c.status === "active" ? "green" : "red"}>{t(`centers.status.${c.status}`)}</Badge>
                </div>
                <p className="mt-3 text-sm text-slate-600">
                  {fmt.number(c.userCount)} {t("centers.users")} · {fmt.number(c.doctorCount)} {t("centers.doctors")}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <CreateCenterModal open={creating} onClose={() => setCreating(false)} />
    </>
  );
}

function CreateCenterModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const errorText = useErrorText();
  const [form, setForm] = useState({ slug: "", nameAr: "", nameEn: "", phone: "", whatsappPhone: "" });
  const [errors, setErrors] = useState<FormErrors>(NO_ERRORS);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const create = useMutation({
    mutationFn: () => api.admin.createCenter(form),
    onSuccess: async ({ center }) => {
      await qc.invalidateQueries({ queryKey: ["admin"] });
      onClose();
      navigate(`/admin/centers/${center.id}`);
    },
    onError: (e) => setErrors(errorText(e)),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErrors(NO_ERRORS);
    create.mutate();
  }

  return (
    <Modal open={open} onClose={onClose} title={t("centers.new")}>
      <form onSubmit={onSubmit} className="space-y-4">
        <Grid2>
          <TextField label={t("centers.nameAr")} dir="rtl" required value={form.nameAr} onChange={set("nameAr")} error={errors.fields.nameAr} />
          <TextField label={t("centers.nameEn")} dir="ltr" required value={form.nameEn} onChange={set("nameEn")} error={errors.fields.nameEn} />
        </Grid2>
        <TextField
          label={t("common.slug")}
          dir="ltr"
          required
          placeholder="al-shifa"
          hint={t("field.invalid_slug")}
          value={form.slug}
          onChange={set("slug")}
          error={errors.fields.slug}
        />
        <Grid2>
          <TextField label={t("common.phone")} dir="ltr" type="tel" optional value={form.phone} onChange={set("phone")} error={errors.fields.phone} />
          <TextField
            label={t("centers.whatsapp")}
            dir="ltr"
            type="tel"
            optional
            placeholder="09XX XXX XXX"
            value={form.whatsappPhone}
            onChange={set("whatsappPhone")}
            error={errors.fields.whatsappPhone}
          />
        </Grid2>
        {errors.message && <Alert>{errors.message}</Alert>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" busy={create.isPending}>
            {t("common.create")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
