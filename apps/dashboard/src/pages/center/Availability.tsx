import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useSearchParams } from "react-router";
import { addDays, todayIn, weekStart } from "@mc/shared";
import { api, ApiRequestError } from "../../api";
import { useI18n } from "../../i18n";
import type { AffectedAppointment, AvailabilitySession, CopyWeekResult, Doctor } from "../../types";
import { Alert, Badge, Button, Card, Empty, Loading, Modal, PageHeader, SelectField, TextField, Toggle, useErrorText, useFlash } from "../../ui";

/** The center's time zone (Asia/Damascus for the pilot). */
function useTimeZone() {
  const settings = useQuery({ queryKey: ["center", "settings"], queryFn: api.center.settings });
  return settings.data?.center.timezone ?? "Asia/Damascus";
}

/** Locale-aware date and time labels for the planner. */
function useLabels() {
  const { locale } = useI18n();
  const timeZone = useTimeZone();
  const tag = locale === "ar" ? "ar-SY-u-nu-latn" : "en-GB";
  const atNoonUtc = (date: string) => new Date(`${date}T12:00:00Z`);
  return {
    weekday: (date: string) => new Intl.DateTimeFormat(tag, { weekday: "long", timeZone: "UTC" }).format(atNoonUtc(date)),
    dayMonth: (date: string) => new Intl.DateTimeFormat(tag, { day: "numeric", month: "short", timeZone: "UTC" }).format(atNoonUtc(date)),
    time: (hhmm: string) =>
      new Intl.DateTimeFormat(tag, { hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(new Date(`1970-01-01T${hhmm}:00Z`)),
    instantTime: (iso: string) => new Intl.DateTimeFormat(tag, { dateStyle: "medium", timeStyle: "short", timeZone }).format(new Date(iso)),
  };
}

export function AvailabilityPage() {
  const { t, pick } = useI18n();
  const labels = useLabels();
  const [params, setParams] = useSearchParams();
  const today = todayIn(useTimeZone());
  const week = weekStart(params.get("week") ?? today);
  const doctors = useQuery({ queryKey: ["center", "doctors"], queryFn: api.center.doctors });
  const active = (doctors.data?.doctors ?? []).filter((d) => d.isActive);
  const doctorId = params.get("doctor") ?? active[0]?.id ?? "";
  const doctor = active.find((d) => d.id === doctorId);
  const [copyOpen, setCopyOpen] = useState(false);
  const [flash, setFlash] = useFlash();

  const setParam = (key: string, value: string) =>
    setParams((p) => {
      const next = new URLSearchParams(p);
      next.set(key, value);
      return next;
    });

  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  const sessions = useQuery({
    queryKey: ["center", "availability", doctorId, week],
    queryFn: () => api.center.availability({ from: week, to: addDays(week, 6), doctorId }),
    enabled: !!doctorId,
  });

  if (doctors.isPending) return <Loading />;
  if (!active.length) {
    return (
      <>
        <PageHeader title={t("availability.title")} />
        <Empty>{t("availability.noDoctors")}</Empty>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={t("availability.title")}
        actions={
          <Button variant="secondary" onClick={() => setCopyOpen(true)}>
            {t("availability.copyPrev")}
          </Button>
        }
      />
      <p className="mb-4 max-w-2xl text-sm text-slate-600">{t("availability.hint")}</p>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="w-full sm:w-72">
          <SelectField label={t("availability.doctor")} value={doctorId} onChange={(e) => setParam("doctor", e.target.value)}>
            {active.map((d) => (
              <option key={d.id} value={d.id}>
                {pick(d.nameAr, d.nameEn)}
              </option>
            ))}
          </SelectField>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="secondary" aria-label={t("availability.prevWeek")} onClick={() => setParam("week", addDays(week, -7))}>
            <span className="rtl:rotate-180">‹</span>
          </Button>
          <span className="min-w-40 px-2 text-center text-sm font-medium">
            {labels.dayMonth(week)} – {labels.dayMonth(addDays(week, 6))}
          </span>
          <Button variant="secondary" aria-label={t("availability.nextWeek")} onClick={() => setParam("week", addDays(week, 7))}>
            <span className="rtl:rotate-180">›</span>
          </Button>
          {week !== weekStart(today) && (
            <Button variant="ghost" onClick={() => setParam("week", weekStart(today))}>
              {t("availability.thisWeek")}
            </Button>
          )}
        </div>
      </div>

      {flash && (
        <div className="mb-4">
          <Alert tone="success">{flash}</Alert>
        </div>
      )}

      {sessions.isPending ? (
        <Loading />
      ) : (
        <ol className="space-y-3">
          {days.map((date) => (
            <DayRow
              key={date}
              date={date}
              today={today}
              doctor={doctor!}
              sessions={(sessions.data?.sessions ?? []).filter((s) => s.date === date)}
            />
          ))}
        </ol>
      )}

      {copyOpen && (
        <CopyWeekModal
          week={week}
          doctor={doctor!}
          onClose={() => setCopyOpen(false)}
          onDone={(n) => {
            setCopyOpen(false);
            setFlash(t("availability.copied", { n }));
          }}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------- one day

function DayRow({ date, today, doctor, sessions }: { date: string; today: string; doctor: Doctor; sessions: AvailabilitySession[] }) {
  const { t } = useI18n();
  const labels = useLabels();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<AvailabilitySession | null>(null);
  const past = date < today;

  return (
    <li className={`rounded-2xl bg-white p-4 ring-1 ${date === today ? "ring-brand-600" : "ring-slate-200"} ${past ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-start gap-3 sm:flex-nowrap">
        <div className="w-28 shrink-0">
          <p className="font-semibold">{labels.weekday(date)}</p>
          <p className="text-sm text-slate-500">
            {labels.dayMonth(date)}
            {date === today && <span className="ms-1 font-medium text-brand-700">· {t("availability.today")}</span>}
          </p>
        </div>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          {sessions.length === 0 && !adding && <span className="text-sm text-slate-400">{t("availability.noSessions")}</span>}
          {sessions.map((s) => (
            <button
              key={s.id}
              type="button"
              disabled={past}
              onClick={() => setEditing(s)}
              className={`rounded-xl px-3 py-2 text-start text-sm ring-1 transition ${
                s.status === "open" ? "bg-brand-50 ring-brand-600/30 hover:ring-brand-600" : "bg-slate-100 text-slate-500 line-through ring-slate-200"
              }`}
            >
              <span className="font-semibold">
                {labels.time(s.startTime)} – {labels.time(s.endTime)}
              </span>
              <span className="ms-2 inline-flex gap-1 align-middle no-underline">
                {s.bookedCount > 0 && <Badge tone="amber">{t("availability.booked", { n: s.bookedCount })}</Badge>}
                {s.status === "closed" && <Badge>{t("availability.closed")}</Badge>}
              </span>
              {s.note && <span className="block text-xs text-slate-500">{s.note}</span>}
            </button>
          ))}
          {!past && !adding && (
            <Button variant="ghost" onClick={() => setAdding(true)}>
              + {t("availability.addSession")}
            </Button>
          )}
        </div>
      </div>
      {adding && <AddSessionForm date={date} doctor={doctor} previous={sessions.at(-1)} onDone={() => setAdding(false)} />}
      {editing && <EditSessionModal session={editing} onClose={() => setEditing(null)} />}
    </li>
  );
}

function AddSessionForm({
  date,
  doctor,
  previous,
  onDone,
}: {
  date: string;
  doctor: Doctor;
  previous?: AvailabilitySession;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const errorText = useErrorText();
  // Default: 16:00–20:00, or right after the day's last session.
  const [startTime, setStart] = useState(previous?.endTime ?? "16:00");
  const [endTime, setEnd] = useState(previous ? "" : "20:00");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => api.center.createSession({ doctorId: doctor.id, date, startTime, endTime, note }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["center", "availability"] });
      onDone();
    },
    onError: (e) => setError(errorText(e).message),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    save.mutate();
  }

  return (
    <form onSubmit={onSubmit} className="mt-3 space-y-3 border-t border-slate-100 pt-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-32">
          <TextField label={t("availability.from")} type="time" dir="ltr" required step={300} value={startTime} onChange={(e) => setStart(e.target.value)} />
        </div>
        <div className="w-32">
          <TextField label={t("availability.to")} type="time" dir="ltr" required step={300} value={endTime} onChange={(e) => setEnd(e.target.value)} />
        </div>
        <div className="min-w-40 flex-1">
          <TextField label={t("availability.note")} optional value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onDone}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" busy={save.isPending}>
            {t("common.add")}
          </Button>
        </div>
      </div>
      {error && <Alert>{error}</Alert>}
    </form>
  );
}

// ---------------------------------------------------------------- edit / close / delete

function EditSessionModal({ session, onClose }: { session: AvailabilitySession; onClose: () => void }) {
  const { t } = useI18n();
  const labels = useLabels();
  const qc = useQueryClient();
  const errorText = useErrorText();
  const [startTime, setStart] = useState(session.startTime);
  const [endTime, setEnd] = useState(session.endTime);
  const [note, setNote] = useState(session.note ?? "");
  const [error, setError] = useState<string | null>(null);
  /** Pending action blocked by booked appointments, waiting for "apply anyway". */
  const [blocked, setBlocked] = useState<{ affected: AffectedAppointment[]; retry: () => void } | null>(null);

  const done = async () => {
    await qc.invalidateQueries({ queryKey: ["center", "availability"] });
    onClose();
  };
  const handle = (retry: () => void) => (e: unknown) => {
    if (e instanceof ApiRequestError && e.code === "session_has_appointments") {
      setBlocked({ affected: (e.body as { affected: AffectedAppointment[] }).affected, retry });
    } else setError(errorText(e).message);
  };

  const update = useMutation({
    mutationFn: (v: { status?: "open" | "closed"; confirm?: boolean }) =>
      api.center.updateSession(session.id, { startTime, endTime, note, ...v }),
    onSuccess: done,
  });
  const remove = useMutation({ mutationFn: (confirm: boolean) => api.center.deleteSession(session.id, confirm), onSuccess: done });

  const save = (status?: "open" | "closed") =>
    update.mutate({ status }, { onError: handle(() => update.mutate({ status, confirm: true }, { onError: (e) => setError(errorText(e).message) })) });
  const del = () => remove.mutate(false, { onError: handle(() => remove.mutate(true)) });

  return (
    <Modal open onClose={onClose} title={`${t("availability.editTitle")} · ${labels.weekday(session.date)} ${labels.dayMonth(session.date)}`}>
      {blocked ? (
        <div className="space-y-4">
          <Alert tone="warning">
            <p className="font-semibold">{t("availability.affectedTitle")}</p>
            <p>{t("availability.affectedHint")}</p>
          </Alert>
          <ul className="divide-y divide-slate-100 rounded-lg ring-1 ring-slate-200">
            {blocked.affected.map((a) => (
              <li key={a.id} className="flex flex-wrap justify-between gap-2 px-3 py-2 text-sm">
                <span className="font-medium">{a.patientName}</span>
                <a dir="ltr" href={`tel:${a.patientPhone}`} className="text-brand-700">
                  {a.patientPhone}
                </a>
                <span className="w-full text-slate-500">
                  {labels.instantTime(a.startAt)} · <span dir="ltr">{a.referenceCode}</span>
                </span>
              </li>
            ))}
          </ul>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setBlocked(null)}>
              {t("common.back")}
            </Button>
            <Button variant="danger" busy={update.isPending || remove.isPending} onClick={blocked.retry}>
              {t("availability.applyAnyway")}
            </Button>
          </div>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            save();
          }}
          className="space-y-4"
        >
          <div className="grid grid-cols-2 gap-3">
            <TextField label={t("availability.from")} type="time" dir="ltr" required step={300} value={startTime} onChange={(e) => setStart(e.target.value)} />
            <TextField label={t("availability.to")} type="time" dir="ltr" required step={300} value={endTime} onChange={(e) => setEnd(e.target.value)} />
          </div>
          <TextField label={t("availability.note")} optional value={note} onChange={(e) => setNote(e.target.value)} />
          {session.bookedCount > 0 && <Badge tone="amber">{t("availability.booked", { n: session.bookedCount })}</Badge>}
          {error && <Alert>{error}</Alert>}
          <div className="flex flex-wrap justify-between gap-2">
            <div className="flex flex-wrap gap-2">
              <Button variant="danger" onClick={() => save(session.status === "open" ? "closed" : "open")} disabled={update.isPending}>
                {session.status === "open" ? t("availability.close") : t("availability.reopen")}
              </Button>
              <Button variant="danger" onClick={del} busy={remove.isPending}>
                {t("availability.delete")}
              </Button>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={onClose}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" busy={update.isPending}>
                {t("common.save")}
              </Button>
            </div>
          </div>
        </form>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------- copy week

function CopyWeekModal({ week, doctor, onClose, onDone }: { week: string; doctor: Doctor; onClose: () => void; onDone: (n: number) => void }) {
  const { t, tx, pick } = useI18n();
  const labels = useLabels();
  const qc = useQueryClient();
  const errorText = useErrorText();
  const [allDoctors, setAllDoctors] = useState(false);
  const fromWeek = addDays(week, -7);
  const doctors = useQuery({ queryKey: ["center", "doctors"], queryFn: api.center.doctors });
  const nameOf = (id: string) => {
    const d = doctors.data?.doctors.find((x) => x.id === id);
    return d ? pick(d.nameAr, d.nameEn) : "";
  };
  const input = { fromWeek, toWeek: week, doctorId: allDoctors ? undefined : doctor.id };

  const preview = useQuery({
    queryKey: ["center", "availability", "copy-preview", input],
    queryFn: () => api.center.copyWeek({ ...input, dryRun: true }),
  });
  const apply = useMutation({
    mutationFn: () => api.center.copyWeek({ ...input, dryRun: false }),
    onSuccess: async (r) => {
      await qc.invalidateQueries({ queryKey: ["center", "availability"] });
      onDone(r.planned.length);
    },
  });

  const row = (p: CopyWeekResult["planned"][number]) => (
    <>
      {allDoctors && <span className="font-medium">{nameOf(p.doctorId)} · </span>}
      {labels.weekday(p.date)} {labels.dayMonth(p.date)} · {labels.time(p.startTime)} – {labels.time(p.endTime)}
    </>
  );

  return (
    <Modal open onClose={onClose} title={t("availability.copyTitle")}>
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          {t("availability.copyIntro", { from: `${labels.dayMonth(fromWeek)} – ${labels.dayMonth(addDays(fromWeek, 6))}` })}
        </p>
        <Toggle checked={allDoctors} onChange={setAllDoctors} label={t("availability.allDoctors")} />
        {preview.isPending ? (
          <Loading />
        ) : preview.isError ? (
          <Alert>{errorText(preview.error).message}</Alert>
        ) : (
          <>
            {preview.data.planned.length === 0 ? (
              <Empty>{t("availability.copyNothing")}</Empty>
            ) : (
              <ul className="max-h-64 space-y-1 overflow-y-auto text-sm">
                {preview.data.planned.map((p, i) => (
                  <li key={i} className="rounded-lg bg-brand-50 px-3 py-2">
                    {row(p)}
                  </li>
                ))}
              </ul>
            )}
            {preview.data.skipped.length > 0 && (
              <Card className="!p-3">
                <p className="mb-1 text-sm font-medium">{t("availability.skipped")}</p>
                <ul className="space-y-1 text-sm text-slate-600">
                  {preview.data.skipped.map((p, i) => (
                    <li key={i}>
                      {row(p)} — {tx(`availability.reason.${p.reason}`, p.reason)}
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </>
        )}
        {apply.isError && <Alert>{errorText(apply.error).message}</Alert>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={() => apply.mutate()} busy={apply.isPending} disabled={!preview.data?.planned.length}>
            {t("availability.copyCreate", { n: preview.data?.planned.length ?? 0 })}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
