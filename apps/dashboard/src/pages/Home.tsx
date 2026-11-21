import { useNavigate } from "react-router";
import type { SessionUser } from "@mc/shared";
import { api } from "../api";
import { useSetMe } from "../auth";
import { LanguageSwitch, useI18n } from "../i18n";

/** Placeholder home. The Today screen (spec §11.1) replaces it in milestone M4. */
export function HomePage({ user }: { user: SessionUser }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const setMe = useSetMe();

  async function logout() {
    await api.logout().catch(() => undefined);
    setMe(null);
    navigate("/login", { replace: true });
  }

  return (
    <div className="min-h-dvh">
      <header className="flex items-center justify-between gap-2 border-b border-slate-200 bg-white px-4 py-3">
        <div className="flex items-center gap-2">
          <img src="/icon.svg" alt="" className="size-8" />
          <span className="font-semibold">{t("app.name")}</span>
        </div>
        <div className="flex items-center gap-1">
          <LanguageSwitch />
          <button type="button" onClick={logout} className="rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100">
            {t("common.logout")}
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">
        <h1 className="text-2xl font-semibold">{t("dashboard.welcome", { name: user.name })}</h1>
        <p className="mt-1 text-slate-600">{t("dashboard.role", { role: t(`role.${user.role}`) })}</p>
      </main>
    </div>
  );
}
