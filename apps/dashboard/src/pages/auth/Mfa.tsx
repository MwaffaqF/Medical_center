import { useMutation } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import { renderSVG } from "uqr";
import { api } from "../../api";
import { useSetMe } from "../../auth";
import { useI18n } from "../../i18n";
import { Alert, Button, TextField, useErrorText } from "../../ui";
import { AuthCard } from "./AuthCard";

/** Super admin: first-time 2FA setup (setup=true) or the code step at each sign-in. */
export function MfaPage({ setup }: { setup: boolean }) {
  const { t } = useI18n();
  const setMe = useSetMe();
  const errorText = useErrorText();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  const start = useMutation({ mutationFn: api.mfaSetup });
  const { mutate: startSetup } = start;
  useEffect(() => {
    if (setup) startSetup();
  }, [setup, startSetup]);

  const verify = useMutation({
    mutationFn: () => api.mfaVerify(code.trim()),
    onSuccess: (me) => setMe(me),
    onError: (e) => {
      setError(errorText(e).message);
      setCode("");
    },
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    verify.mutate();
  }

  return (
    <AuthCard title={setup ? t("mfa.setupTitle") : t("mfa.title")}>
      <form onSubmit={onSubmit} className="space-y-4">
        <p className="text-sm text-slate-600">{setup ? t("mfa.setupIntro") : t("mfa.intro")}</p>
        {setup && start.data && (
          <div className="space-y-3">
            <div
              className="mx-auto w-48 rounded-lg bg-white p-2 ring-1 ring-slate-200"
              // SVG generated locally from our own otpauth URI; no user-controlled markup.
              dangerouslySetInnerHTML={{ __html: renderSVG(start.data.otpauthUri, { border: 1 }) }}
            />
            <p className="text-xs text-slate-500">{t("mfa.manualKey")}</p>
            <code dir="ltr" className="block break-all rounded-md bg-slate-100 px-3 py-2 text-center font-mono text-sm tracking-wider">
              {start.data.secret.match(/.{1,4}/g)?.join(" ")}
            </code>
          </div>
        )}
        {setup && start.isError && <Alert>{errorText(start.error).message}</Alert>}
        <TextField
          label={t("mfa.code")}
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          dir="ltr"
          required
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-center font-mono text-2xl tracking-[0.5em] focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
        />
        {error && <Alert>{error}</Alert>}
        <Button type="submit" className="w-full py-2.5" busy={verify.isPending} disabled={code.length !== 6}>
          {t("mfa.verify")}
        </Button>
      </form>
    </AuthCard>
  );
}
