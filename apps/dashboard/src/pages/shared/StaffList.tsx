import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import type { StaffRole, UserCreateInput, UserUpdateInput } from "@mc/shared";
import { useMe } from "../../auth";
import { useI18n } from "../../i18n";
import type { StaffUser } from "../../types";
import {
  Alert,
  Badge,
  Button,
  Card,
  Empty,
  Grid2,
  Loading,
  Modal,
  NO_ERRORS,
  SelectField,
  TemporaryPassword,
  TextField,
  useErrorText,
  useFormat,
  type FormErrors,
} from "../../ui";

type Props = {
  title: string;
  queryKey: readonly unknown[];
  load: () => Promise<{ users: StaffUser[] }>;
  create: (input: UserCreateInput) => Promise<{ user: StaffUser; temporaryPassword: string }>;
  update: (id: string, input: UserUpdateInput) => Promise<{ user: StaffUser }>;
  resetPassword: (id: string) => Promise<{ temporaryPassword: string }>;
};

/** Staff accounts table with add / deactivate / reset password. Used by the platform console and by managers. */
export function StaffList({ title, queryKey, load, create, update, resetPassword }: Props) {
  const { t } = useI18n();
  const fmt = useFormat();
  const me = useMe();
  const qc = useQueryClient();
  const errorText = useErrorText();
  const users = useQuery({ queryKey, queryFn: load });
  const [adding, setAdding] = useState(false);
  const [shownPassword, setShownPassword] = useState<{ name: string; password: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggle = useMutation({
    mutationFn: (u: StaffUser) => update(u.id, { isActive: !u.isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey }),
    onError: (e) => setError(errorText(e).message),
  });
  const reset = useMutation({
    mutationFn: async (u: StaffUser) => ({ name: u.name, password: (await resetPassword(u.id)).temporaryPassword }),
    onSuccess: (r) => {
      setShownPassword(r);
      void qc.invalidateQueries({ queryKey });
    },
    onError: (e) => setError(errorText(e).message),
  });

  return (
    <Card title={title} actions={<Button onClick={() => setAdding(true)}>{t("staff.add")}</Button>}>
      {error && (
        <div className="mb-3">
          <Alert>{error}</Alert>
        </div>
      )}
      {users.isPending ? (
        <Loading />
      ) : !users.data?.users.length ? (
        <Empty />
      ) : (
        <ul className="divide-y divide-slate-100">
          {users.data.users.map((u) => (
            <li key={u.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="font-medium">
                  {u.name} <span className="text-sm font-normal text-slate-500">· {t(`role.${u.role}`)}</span>
                </p>
                <p dir="ltr" className="text-start text-sm text-slate-500">
                  {u.email}
                </p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  <Badge tone={u.isActive ? "green" : "slate"}>{u.isActive ? t("common.active") : t("common.inactive")}</Badge>
                  {u.mustChangePassword && <Badge tone="amber">{t("staff.mustChange")}</Badge>}
                  <span className="text-xs text-slate-500">
                    {t("common.lastLogin")}: {u.lastLoginAt ? fmt.dateTime(u.lastLoginAt) : t("common.never")}
                  </span>
                </div>
              </div>
              {u.id !== me.data?.user.id && (
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => window.confirm(t("password.resetConfirm")) && reset.mutate(u)}
                    disabled={reset.isPending}
                  >
                    {t("password.reset")}
                  </Button>
                  <Button variant={u.isActive ? "danger" : "secondary"} onClick={() => toggle.mutate(u)} disabled={toggle.isPending}>
                    {u.isActive ? t("staff.deactivate") : t("staff.activate")}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <AddUserModal
        open={adding}
        onClose={() => setAdding(false)}
        create={create}
        onCreated={(name, password) => {
          setAdding(false);
          setShownPassword({ name, password });
          void qc.invalidateQueries({ queryKey });
        }}
      />
      <Modal open={!!shownPassword} onClose={() => setShownPassword(null)} title={shownPassword?.name ?? ""}>
        {shownPassword && <TemporaryPassword password={shownPassword.password} />}
        <div className="mt-4 flex justify-end">
          <Button onClick={() => setShownPassword(null)}>{t("common.close")}</Button>
        </div>
      </Modal>
    </Card>
  );
}

function AddUserModal({
  open,
  onClose,
  create,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  create: Props["create"];
  onCreated: (name: string, password: string) => void;
}) {
  const { t } = useI18n();
  const errorText = useErrorText();
  const empty = { name: "", email: "", role: "receptionist" as StaffRole, preferredLocale: "ar" as "ar" | "en" };
  const [form, setForm] = useState(empty);
  const [errors, setErrors] = useState<FormErrors>(NO_ERRORS);

  const save = useMutation({
    mutationFn: () => create(form),
    onSuccess: (r) => {
      setForm(empty);
      setErrors(NO_ERRORS);
      onCreated(r.user.name, r.temporaryPassword);
    },
    onError: (e) => setErrors(errorText(e)),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }

  return (
    <Modal open={open} onClose={onClose} title={t("staff.add")}>
      <form onSubmit={onSubmit} className="space-y-4">
        <TextField label={t("common.name")} required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} error={errors.fields.name} />
        <TextField
          label={t("common.email")}
          type="email"
          dir="ltr"
          required
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          error={errors.fields.email}
        />
        <Grid2>
          <SelectField label={t("common.role")} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as StaffRole })}>
            <option value="receptionist">{t("role.receptionist")}</option>
            <option value="manager">{t("role.manager")}</option>
            <option value="doctor">{t("role.doctor")}</option>
          </SelectField>
          <SelectField
            label={t("staff.language")}
            value={form.preferredLocale}
            onChange={(e) => setForm({ ...form, preferredLocale: e.target.value as "ar" | "en" })}
          >
            <option value="ar">العربية</option>
            <option value="en">English</option>
          </SelectField>
        </Grid2>
        {errors.message && <Alert>{errors.message}</Alert>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" busy={save.isPending}>
            {t("common.create")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
