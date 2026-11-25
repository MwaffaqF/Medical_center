import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { api } from "../../api";
import { useI18n } from "../../i18n";
import { Badge, Empty, Loading, PageHeader, useFormat } from "../../ui";

export function DoctorsPage() {
  const { t, pick } = useI18n();
  const fmt = useFormat();
  const doctors = useQuery({ queryKey: ["center", "doctors"], queryFn: api.center.doctors });
  const specialties = useQuery({ queryKey: ["center", "specialties"], queryFn: api.center.specialties });
  const specialtyName = (id: string | null) => {
    const s = specialties.data?.specialties.find((x) => x.id === id);
    return s ? pick(s.nameAr, s.nameEn) : null;
  };

  return (
    <>
      <PageHeader
        title={t("doctors.title")}
        actions={
          <Link to="/doctors/new" className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800">
            {t("doctors.add")}
          </Link>
        }
      />
      {doctors.isPending ? (
        <Loading />
      ) : !doctors.data?.doctors.length ? (
        <Empty />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {doctors.data.doctors.map((d) => {
            const offered = d.services.filter((s) => s.isActive);
            return (
              <li key={d.id}>
                <Link to={`/doctors/${d.id}`} className="flex gap-3 rounded-2xl bg-white p-4 ring-1 ring-slate-200 transition hover:ring-brand-600">
                  <Avatar url={d.photoUrl} name={pick(d.nameAr, d.nameEn)} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="truncate font-semibold">{pick(d.nameAr, d.nameEn)}</p>
                      {!d.isActive && <Badge>{t("common.inactive")}</Badge>}
                    </div>
                    <p className="truncate text-sm text-slate-500">{specialtyName(d.primarySpecialtyId) ?? pick(d.titleAr, d.titleEn)}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {offered.length ? (
                        offered.map((s) => (
                          <Badge key={s.id} tone="brand">
                            {t(`booking.${s.bookingType}`)} · {s.durationMinutes} {t("common.minutes")} · {fmt.number(s.price)}
                          </Badge>
                        ))
                      ) : (
                        <Badge tone="amber">{t("doctors.noServices")}</Badge>
                      )}
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

export function Avatar({ url, name, size = "size-14" }: { url: string | null; name: string; size?: string }) {
  if (url) return <img src={url} alt="" className={`${size} shrink-0 rounded-full object-cover ring-1 ring-slate-200`} />;
  const initial = name.replace(/^(د\.|Dr\.?)\s*/i, "").trim().charAt(0);
  return (
    <span className={`${size} flex shrink-0 items-center justify-center rounded-full bg-brand-50 text-lg font-semibold text-brand-700`}>
      {initial}
    </span>
  );
}
