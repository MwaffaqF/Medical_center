import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { NavLink, useNavigate } from "react-router";
import type { MessageKey, SessionUser } from "@mc/shared";
import { api } from "./api";
import { useRefreshSession, useSetMe } from "./auth";
import { LanguageSwitch, useI18n } from "./i18n";

type NavItem = { to: string; label: MessageKey; end?: boolean };

function navFor(user: SessionUser): NavItem[] {
  const inCenter = user.role !== "super_admin" || !!user.supportCenterId;
  const items: NavItem[] = [];
  if (user.role === "super_admin") {
    items.push({ to: "/admin", label: "nav.centers", end: true }, { to: "/admin/activity", label: "nav.activity" });
  }
  if (inCenter) {
    items.push({ to: "/", label: "nav.home", end: true });
    if (user.role !== "doctor") items.push({ to: "/availability", label: "nav.availability" });
    if (user.role === "manager" || user.role === "super_admin") {
      items.push(
        { to: "/doctors", label: "nav.doctors" },
        { to: "/specialties", label: "nav.specialties" },
        { to: "/staff", label: "nav.staff" },
        { to: "/settings", label: "nav.settings", end: true },
        { to: "/settings/templates", label: "nav.templates" },
      );
    }
  }
  return items;
}

export function AppShell({ user, children }: { user: SessionUser; children: ReactNode }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const setMe = useSetMe();
  const [menuOpen, setMenuOpen] = useState(false);
  const items = navFor(user);

  async function logout() {
    await api.logout().catch(() => undefined);
    setMe(null);
    navigate("/login", { replace: true });
  }

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `block rounded-lg px-3 py-2 text-sm font-medium ${isActive ? "bg-brand-50 text-brand-800" : "text-slate-700 hover:bg-slate-100"}`;

  return (
    <div className="min-h-dvh">
      {user.supportCenterId && <SupportBanner centerId={user.supportCenterId} />}
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="Menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((o) => !o)}
              className="rounded-md p-2 text-slate-600 hover:bg-slate-100 md:hidden"
            >
              <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <img src="/icon.svg" alt="" className="size-8" />
            <span className="font-semibold">{t("app.name")}</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="hidden text-sm text-slate-500 sm:inline">{user.name}</span>
            <LanguageSwitch />
            <button type="button" onClick={logout} className="rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100">
              {t("common.logout")}
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-6xl gap-6 px-4 py-6">
        <nav
          className={`${menuOpen ? "block" : "hidden"} fixed inset-x-0 top-[57px] z-10 border-b border-slate-200 bg-white p-3 shadow-sm md:static md:block md:w-52 md:shrink-0 md:border-0 md:bg-transparent md:p-0 md:shadow-none`}
          onClick={() => setMenuOpen(false)}
        >
          <ul className="space-y-1">
            {items.map((item) => (
              <li key={item.to}>
                <NavLink to={item.to} end={item.end} className={linkClass}>
                  {t(item.label)}
                </NavLink>
              </li>
            ))}
            <li className="border-t border-slate-200 pt-1">
              <NavLink to="/account/password" className={linkClass}>
                {t("nav.changePassword")}
              </NavLink>
            </li>
          </ul>
        </nav>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}

function SupportBanner({ centerId }: { centerId: string }) {
  const { t, pick } = useI18n();
  const navigate = useNavigate();
  const refresh = useRefreshSession();
  const center = useQuery({ queryKey: ["center", "settings"], queryFn: api.center.settings });
  const name = center.data ? pick(center.data.center.nameAr, center.data.center.nameEn) : "…";

  async function exit() {
    await api.admin.exitSupport();
    await refresh();
    navigate(`/admin/centers/${centerId}`, { replace: true });
  }

  return (
    <div className="bg-amber-400 text-amber-950">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
        <span className="font-medium">{t("support.banner", { center: name })}</span>
        <button type="button" onClick={exit} className="rounded-md bg-amber-950/10 px-3 py-1 font-semibold hover:bg-amber-950/20">
          {t("support.exit")}
        </button>
      </div>
    </div>
  );
}
