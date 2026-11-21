import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router";
import { api } from "../../api";
import { useRefreshSession } from "../../auth";
import { useI18n } from "../../i18n";
import type { Center } from "../../types";
import { Alert, Badge, Button, Card, Grid2, Loading, NO_ERRORS, PageHeader, TextField, useErrorText, useFlash, type FormErrors } from "../../ui";
import { StaffList } from "../shared/StaffList";
import { ActivityTable } from "./Activity";

export function CenterDetailPage() {
  const { id = "" } = useParams();
  const { t, pick } = useI18n();
  const navigate = useNavigate();
  const refresh = useRefreshSession();
  const center = useQuery({ queryKey: ["admin", "center", id], queryFn: () => api.admin.center(id) });

  const support = useMutation({
    mutationFn: () => api.admin.startSupport(id),
    onSuccess: async () => {
      await refresh();
      navigate("/", { replace: true });
    },
  });

  if (center.isPending) return <Loading />;
  if (!center.data) return <Alert>{t("error.generic")}</Alert>;
  const c = center.data.center;

  return (
    <>
      <PageHeader
        title={pick(c.nameAr, c.nameEn)}
        back="/admin"
        actions={
          <Button onClick={() => support.mutate()} busy={support.isPending} disabled={c.status !== "active"}>
            {t("support.open")}
          </Button>
        }
      />
      <div className="space-y-6">
        <CenterForm center={c} />
        <StaffList
          title={t("centers.staff")}
          queryKey={["admin", "center", id, "users"]}
          load={() => api.admin.users(id)}
          create={(input) => api.admin.createUser(id, input)}
          update={api.admin.updateUser}
          resetPassword={api.admin.resetPassword}
        />
        <Card title={t("activity.title")}>
          <ActivityTable centerId={id} />
        </Card>
      </div>
    </>
  );
}

function CenterForm({ center }: { center: Center }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const errorText = useErrorText();
  const [flash, setFlash] = useFlash();
  const [form, setForm] = useState({ nameAr: center.nameAr, nameEn: center.nameEn, slug: center.slug });
  const [errors, setErrors] = useState<FormErrors>(NO_ERRORS);
  useEffect(() => setForm({ nameAr: center.nameAr, nameEn: center.nameEn, slug: center.slug }), [center]);

  const save = useMutation({
    mutationFn: (input: Parameters<typeof api.admin.updateCenter>[1]) => api.admin.updateCenter(center.id, input),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["admin"] });
      setErrors(NO_ERRORS);
      setFlash(t("common.saved"));
    },
    onError: (e) => setErrors(errorText(e)),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    save.mutate(form);
  }

  function toggleStatus() {
    if (center.status === "active" && !window.confirm(t("centers.suspendConfirm"))) return;
    save.mutate({ status: center.status === "active" ? "suspended" : "active" });
  }

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <Card
      title={t("settings.info")}
      actions={<Badge tone={center.status === "active" ? "green" : "red"}>{t(`centers.status.${center.status}`)}</Badge>}
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <Grid2>
          <TextField label={t("centers.nameAr")} dir="rtl" required value={form.nameAr} onChange={set("nameAr")} error={errors.fields.nameAr} />
          <TextField label={t("centers.nameEn")} dir="ltr" required value={form.nameEn} onChange={set("nameEn")} error={errors.fields.nameEn} />
        </Grid2>
        <TextField label={t("common.slug")} dir="ltr" required value={form.slug} onChange={set("slug")} error={errors.fields.slug} />
        {errors.message && <Alert>{errors.message}</Alert>}
        {flash && <Alert tone="success">{flash}</Alert>}
        <div className="flex flex-wrap justify-between gap-2">
          <Button variant={center.status === "active" ? "danger" : "secondary"} onClick={toggleStatus} disabled={save.isPending}>
            {center.status === "active" ? t("centers.suspend") : t("centers.reactivate")}
          </Button>
          <Button type="submit" busy={save.isPending}>
            {t("common.save")}
          </Button>
        </div>
      </form>
    </Card>
  );
}
