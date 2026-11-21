import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../api";
import { useI18n } from "../../i18n";
import { Badge, Card, Empty, Loading, PageHeader, Toggle, useFormat } from "../../ui";

export function ActivityPage() {
  const { t } = useI18n();
  const [supportOnly, setSupportOnly] = useState(false);
  return (
    <>
      <PageHeader title={t("activity.title")} />
      <Card actions={<Toggle checked={supportOnly} onChange={setSupportOnly} label={t("activity.supportOnly")} />}>
        <ActivityTable supportOnly={supportOnly} />
      </Card>
    </>
  );
}

export function ActivityTable({ centerId, supportOnly }: { centerId?: string; supportOnly?: boolean }) {
  const { t } = useI18n();
  const fmt = useFormat();
  const activity = useQuery({
    queryKey: ["admin", "activity", centerId ?? "all", supportOnly ? "support" : "all"],
    queryFn: () => api.admin.activity({ centerId, supportOnly }),
  });
  if (activity.isPending) return <Loading />;
  if (!activity.data?.activity.length) return <Empty />;
  return (
    <div className="-mx-4 overflow-x-auto sm:mx-0">
      <table className="w-full min-w-[34rem] text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-start text-slate-500">
            <th className="px-4 py-2 text-start font-medium sm:px-2">{t("activity.when")}</th>
            <th className="px-4 py-2 text-start font-medium sm:px-2">{t("activity.who")}</th>
            <th className="px-4 py-2 text-start font-medium sm:px-2">{t("activity.what")}</th>
          </tr>
        </thead>
        <tbody>
          {activity.data.activity.map((a) => (
            <tr key={a.id} className="border-b border-slate-100 last:border-0">
              <td className="whitespace-nowrap px-4 py-2 text-slate-600 sm:px-2">{fmt.dateTime(a.at)}</td>
              <td className="px-4 py-2 sm:px-2">{a.userName ?? "—"}</td>
              <td className="px-4 py-2 sm:px-2">
                <span dir="ltr" className="font-mono text-xs">
                  {a.entity}.{a.action}
                </span>
                {a.isSupportAction && (
                  <span className="ms-2">
                    <Badge tone="amber">{t("activity.supportTag")}</Badge>
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
