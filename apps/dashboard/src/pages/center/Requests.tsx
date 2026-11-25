import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { REQUEST_STATUSES, type RequestStatus, type SessionUser } from "@mc/shared";
import { api } from "../../api";
import { useI18n } from "../../i18n";
import { Phone, RECEPTION, useInvalidateReception, useWhatsApp, useWhen } from "../../reception";
import type { BookingRequest } from "../../types";
import { Alert, Badge, Button, Card, Empty, Loading, PageHeader, useErrorText } from "../../ui";

/** Booking requests inbox (spec §11.5). */
export function RequestsPage({ user }: { user: SessionUser }) {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const tab = (REQUEST_STATUSES as readonly string[]).includes(params.get("tab") ?? "") ? (params.get("tab") as RequestStatus) : "new";
  const requests = useQuery({
    queryKey: [RECEPTION, "requests", tab],
    queryFn: () => api.reception.requests(tab),
    refetchInterval: 60_000,
  });
  const wa = useWhatsApp();
  const readOnly = user.role === "doctor";

  return (
    <>
      <PageHeader title={t("requests.title")} />
      <div role="tablist" className="mb-4 flex gap-1 overflow-x-auto border-b border-slate-200">
        {REQUEST_STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            role="tab"
            aria-selected={tab === s}
            onClick={() => setParams({ tab: s })}
            className={`-mb-px shrink-0 border-b-2 px-4 py-2 text-sm font-medium ${
              tab === s ? "border-brand-700 text-brand-800" : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            {t(`requestStatus.${s}`)}
          </button>
        ))}
      </div>
      {wa.error && (
        <div className="mb-4">
          <Alert>{wa.error}</Alert>
        </div>
      )}
      {requests.isPending ? (
        <Loading />
      ) : requests.error ? (
        <Alert>{t("error.generic")}</Alert>
      ) : requests.data.requests.length === 0 ? (
        <Empty>{t("requests.empty")}</Empty>
      ) : (
        <ul className="space-y-3">
          {requests.data.requests.map((r) => (
            <RequestCard key={r.id} request={r} wa={wa} readOnly={readOnly} />
          ))}
        </ul>
      )}
    </>
  );
}

function RequestCard({ request: r, wa, readOnly }: { request: BookingRequest; wa: ReturnType<typeof useWhatsApp>; readOnly: boolean }) {
  const { t, pick } = useI18n();
  const when = useWhen();
  const errorText = useErrorText();
  const invalidate = useInvalidateReception();
  const [sending, setSending] = useState(false);
  const update = useMutation({
    mutationFn: (status: "new" | "contacted" | "declined") => api.reception.updateRequest(r.id, status),
    onSuccess: invalidate,
  });
  const open = r.status === "new" || r.status === "contacted";
  const preferred = [r.preferredDate ? when.date(r.preferredDate) : null, t(`period.${r.preferredPeriod}`)].filter(Boolean).join(" · ");

  return (
    <li>
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-lg font-semibold">{r.patient.fullName}</p>
            <Phone value={r.patient.phone} />
          </div>
          <div className="text-end text-sm text-slate-500">
            <p dir="ltr" className="font-mono">
              {r.referenceCode}
            </p>
            <p>{t("requests.received", { when: when.dayTime(r.createdAt) })}</p>
          </div>
        </div>
        <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-slate-500">{t("appt.doctor")}</dt>
            <dd className="font-medium">{pick(r.doctor.nameAr, r.doctor.nameEn)}</dd>
          </div>
          <div>
            <dt className="text-slate-500">{t("appt.type")}</dt>
            <dd className="font-medium">{t(`booking.${r.bookingType}`)}</dd>
          </div>
          <div>
            <dt className="text-slate-500">{t("requests.preferred")}</dt>
            <dd className="font-medium">{preferred}</dd>
          </div>
        </dl>
        {r.patientNote && <p className="mt-3 whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm">{r.patientNote}</p>}
        {r.lastMessageAt && (
          <p className="mt-2">
            <Badge tone="green">{t("requests.lastMessage", { when: when.dayTime(r.lastMessageAt) })}</Badge>
          </p>
        )}

        {!readOnly && (
          <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
            {open && (
              <Link
                to={`/appointments/new?request=${r.id}`}
                className="inline-flex items-center rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800"
              >
                {t("requests.convert")}
              </Link>
            )}
            {open && (
              <Button
                variant="secondary"
                busy={sending}
                onClick={async () => {
                  setSending(true);
                  await wa.send(() => api.reception.requestMessage(r.id));
                  setSending(false);
                }}
              >
                {t("appt.sendWhatsApp")}
              </Button>
            )}
            {r.status === "new" && (
              <Button variant="secondary" disabled={update.isPending} onClick={() => update.mutate("contacted")}>
                {t("requests.markContacted")}
              </Button>
            )}
            {open && (
              <Button
                variant="danger"
                disabled={update.isPending}
                onClick={() => window.confirm(t("requests.declineConfirm")) && update.mutate("declined")}
              >
                {t("requests.decline")}
              </Button>
            )}
            {(r.status === "declined" || r.status === "contacted") && (
              <Button variant="ghost" disabled={update.isPending} onClick={() => update.mutate("new")}>
                {t("requests.reopen")}
              </Button>
            )}
            {r.status === "converted" && r.appointmentId && (
              <Link
                to={`/appointments/${r.appointmentId}`}
                className="inline-flex items-center px-1 text-sm font-semibold text-brand-700 hover:underline"
              >
                {t("requests.viewAppointment")}
              </Link>
            )}
          </div>
        )}
        {update.error && (
          <div className="mt-3">
            <Alert>{errorText(update.error).message}</Alert>
          </div>
        )}
      </Card>
    </li>
  );
}
