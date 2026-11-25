import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import type { MessageKey, SessionUser } from "@mc/shared";
import { api } from "../api";
import { useI18n } from "../i18n";
import { Card } from "../ui";
import { TodayPage } from "./center/Today";

/** Center home: the Today screen (spec §11.1), with the setup checklist for managers until it is complete. */
export function HomePage({ user }: { user: SessionUser }) {
  const canConfigure = user.role === "manager" || user.role === "super_admin";
  return <TodayPage readOnly={user.role === "doctor"} top={canConfigure ? <SetupChecklist /> : null} />;
}

export function SetupChecklist() {
  const { t } = useI18n();
  const settings = useQuery({ queryKey: ["center", "settings"], queryFn: api.center.settings });
  const specialties = useQuery({ queryKey: ["center", "specialties"], queryFn: api.center.specialties });
  const doctors = useQuery({ queryKey: ["center", "doctors"], queryFn: api.center.doctors });
  const staff = useQuery({ queryKey: ["center", "users"], queryFn: api.center.users });

  const c = settings.data?.center;
  const docs = doctors.data?.doctors ?? [];
  const steps: { label: MessageKey; done: boolean; to: string }[] = [
    { label: "home.step.settings", done: !!(c?.whatsappPhone && c.addressAr && c.mapUrl), to: "/settings" },
    { label: "home.step.specialties", done: (specialties.data?.specialties.length ?? 0) > 0, to: "/specialties" },
    { label: "home.step.doctors", done: docs.length > 0 && docs.every((d) => d.photoUrl), to: "/doctors" },
    { label: "home.step.services", done: docs.length > 0 && docs.every((d) => d.services.some((s) => s.isActive)), to: "/doctors" },
    { label: "home.step.staff", done: (staff.data?.users ?? []).some((u) => u.role === "receptionist"), to: "/staff" },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  const loaded = [settings, specialties, doctors, staff].every((q) => q.isSuccess);
  if (!loaded || doneCount === steps.length) return null;

  return (
    <Card title={`${t("home.setupChecklist")} · ${doneCount}/${steps.length}`}>
      <ol className="space-y-2">
        {steps.map((s) => (
          <li key={s.label}>
            <Link to={s.to} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-slate-50">
              <span
                className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                  s.done ? "bg-emerald-600 text-white" : "bg-slate-200 text-slate-500"
                }`}
                aria-hidden
              >
                {s.done ? "✓" : ""}
              </span>
              <span className={s.done ? "text-slate-500 line-through" : ""}>{t(s.label)}</span>
            </Link>
          </li>
        ))}
      </ol>
    </Card>
  );
}
