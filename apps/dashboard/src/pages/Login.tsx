import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import type { MessageKey } from "@mc/shared";
import { api, ApiRequestError } from "../api";
import { useSetMe } from "../auth";
import { LanguageSwitch, useI18n } from "../i18n";

const ERROR_KEYS: Record<string, MessageKey> = {
  invalid_credentials: "auth.error.invalid_credentials",
  too_many_attempts: "auth.error.too_many_attempts",
  center_suspended: "auth.error.center_suspended",
};

export function LoginPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const setMe = useSetMe();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<MessageKey | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { user } = await api.login({ email, password });
      setMe(user);
      navigate("/", { replace: true });
    } catch (err) {
      setError((err instanceof ApiRequestError && ERROR_KEYS[err.code]) || "auth.error.generic");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-4 flex justify-end">
          <LanguageSwitch />
        </div>
        <form onSubmit={onSubmit} className="space-y-4 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
          <div className="flex items-center gap-3">
            <img src="/icon.svg" alt="" className="size-10" />
            <div>
              <p className="text-sm text-slate-500">{t("app.name")}</p>
              <h1 className="text-lg font-semibold">{t("auth.title")}</h1>
            </div>
          </div>

          <label className="block">
            <span className="mb-1 block text-sm font-medium">{t("auth.email")}</span>
            <input
              type="email"
              dir="ltr"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-base focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium">{t("auth.password")}</span>
            <input
              type="password"
              dir="ltr"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-base focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
            />
          </label>

          {error && (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {t(error)}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-brand-700 px-4 py-2.5 font-semibold text-white hover:bg-brand-800 disabled:opacity-60"
          >
            {busy ? t("common.loading") : t("auth.submit")}
          </button>
        </form>
      </div>
    </main>
  );
}
