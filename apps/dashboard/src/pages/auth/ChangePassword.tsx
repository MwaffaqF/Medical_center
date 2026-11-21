import { useMutation } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { api } from "../../api";
import { useMe, useSetMe } from "../../auth";
import { useI18n } from "../../i18n";
import { Alert, Button, Card, NO_ERRORS, PageHeader, TextField, useErrorText, useFlash, type FormErrors } from "../../ui";
import { AuthCard } from "./AuthCard";

function PasswordForm({ onDone }: { onDone: () => void }) {
  const { t } = useI18n();
  const errorText = useErrorText();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<FormErrors>(NO_ERRORS);

  const save = useMutation({
    mutationFn: () => api.changePassword({ currentPassword: current, newPassword: next }),
    onSuccess: () => {
      setCurrent("");
      setNext("");
      setConfirm("");
      onDone();
    },
    onError: (e) => setErrors(errorText(e)),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (next !== confirm) {
      setErrors({ message: null, fields: { confirm: t("password.mismatch") } });
      return;
    }
    setErrors(NO_ERRORS);
    save.mutate();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <TextField
        label={t("password.current")}
        type="password"
        autoComplete="current-password"
        dir="ltr"
        required
        value={current}
        onChange={(e) => setCurrent(e.target.value)}
        error={errors.fields.currentPassword}
      />
      <TextField
        label={t("password.new")}
        type="password"
        autoComplete="new-password"
        dir="ltr"
        required
        minLength={10}
        hint={t("field.password_too_short")}
        value={next}
        onChange={(e) => setNext(e.target.value)}
        error={errors.fields.newPassword}
      />
      <TextField
        label={t("password.confirm")}
        type="password"
        autoComplete="new-password"
        dir="ltr"
        required
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        error={errors.fields.confirm}
      />
      {errors.message && <Alert>{errors.message}</Alert>}
      <Button type="submit" busy={save.isPending} className="w-full py-2.5 sm:w-auto">
        {t("common.save")}
      </Button>
    </form>
  );
}

/** Forced change after a temporary password (shown instead of the app). */
export function ForcedPasswordPage() {
  const { t } = useI18n();
  const me = useMe();
  const setMe = useSetMe();
  return (
    <AuthCard title={t("password.title")}>
      <p className="text-sm text-slate-600">{t("password.intro")}</p>
      <PasswordForm
        onDone={() => me.data && setMe({ ...me.data, user: { ...me.data.user, mustChangePassword: false }, restriction: null })}
      />
    </AuthCard>
  );
}

/** Voluntary change from the menu. */
export function AccountPasswordPage() {
  const { t } = useI18n();
  const [flash, setFlash] = useFlash();
  return (
    <>
      <PageHeader title={t("nav.changePassword")} />
      <Card className="max-w-lg">
        <div className="space-y-4">
          {flash && <Alert tone="success">{flash}</Alert>}
          <PasswordForm onDone={() => setFlash(t("password.changed"))} />
        </div>
      </Card>
    </>
  );
}
