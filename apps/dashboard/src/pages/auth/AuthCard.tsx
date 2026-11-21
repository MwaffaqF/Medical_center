import type { ReactNode } from "react";
import { useNavigate } from "react-router";
import { api } from "../../api";
import { useSetMe } from "../../auth";
import { LanguageSwitch, useI18n } from "../../i18n";

/** Centered card used by sign-in, 2FA and forced password change. */
export function AuthCard({ title, children, showLogout = true }: { title: string; children: ReactNode; showLogout?: boolean }) {
  const { t } = useI18n();
  const setMe = useSetMe();
  const navigate = useNavigate();
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm">
        <div className="mb-4 flex justify-between">
          {showLogout ? (
            <button
              type="button"
              className="rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
              onClick={async () => {
                await api.logout().catch(() => undefined);
                setMe(null);
                navigate("/login", { replace: true });
              }}
            >
              {t("common.logout")}
            </button>
          ) : (
            <span />
          )}
          <LanguageSwitch />
        </div>
        <div className="space-y-4 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
          <div className="flex items-center gap-3">
            <img src="/icon.svg" alt="" className="size-10" />
            <div>
              <p className="text-sm text-slate-500">{t("app.name")}</p>
              <h1 className="text-lg font-semibold">{title}</h1>
            </div>
          </div>
          {children}
        </div>
      </div>
    </main>
  );
}
