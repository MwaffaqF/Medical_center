import {
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { Link } from "react-router";
import { ApiRequestError } from "./api";
import { useI18n } from "./i18n";

// ---------------------------------------------------------------- errors

export type FormErrors = { message: string | null; fields: Record<string, string> };
export const NO_ERRORS: FormErrors = { message: null, fields: {} };

/** Turns any thrown error into a translated message plus per-field messages. */
export function useErrorText() {
  const { tx } = useI18n();
  return (err: unknown): FormErrors => {
    if (err instanceof ApiRequestError) {
      const fields = Object.fromEntries(
        Object.entries(err.fields).map(([k, v]) => [k, tx(`field.${v}`, tx("field.invalid"))]),
      );
      return { message: tx(`error.${err.code}`, tx("error.generic")), fields };
    }
    return { message: tx("error.generic"), fields: {} };
  };
}

// ---------------------------------------------------------------- layout

export function PageHeader({ title, back, actions }: { title: string; back?: string; actions?: ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        {back && (
          <Link to={back} className="mb-1 inline-block text-sm text-brand-700 hover:underline">
            {t("common.back")}
          </Link>
        )}
        <h1 className="truncate text-2xl font-semibold">{title}</h1>
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className = "" }: { title?: string; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:p-6 ${className}`}>
      {(title || actions) && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="text-lg font-semibold">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Grid2({ children }: { children: ReactNode }) {
  return <div className="grid gap-4 sm:grid-cols-2">{children}</div>;
}

// ---------------------------------------------------------------- controls

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  busy?: boolean;
};

export function Button({ variant = "primary", busy, disabled, className = "", children, ...rest }: ButtonProps) {
  const { t } = useI18n();
  const styles = {
    primary: "bg-brand-700 text-white hover:bg-brand-800",
    secondary: "bg-white text-slate-800 ring-1 ring-slate-300 hover:bg-slate-50",
    danger: "bg-white text-red-700 ring-1 ring-red-200 hover:bg-red-50",
    ghost: "text-brand-700 hover:bg-brand-50",
  }[variant];
  return (
    <button
      type="button"
      disabled={disabled || busy}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-60 ${styles} ${className}`}
      {...rest}
    >
      {busy ? t("common.loading") : children}
    </button>
  );
}

const inputClass = (invalid: boolean) =>
  `w-full rounded-lg border px-3 py-2 text-base focus:outline-none focus:ring-2 ${
    invalid ? "border-red-400 focus:ring-red-200" : "border-slate-300 focus:border-brand-600 focus:ring-brand-600/20"
  }`;

type FieldProps = { label: string; hint?: string; error?: string; optional?: boolean };

function FieldShell({ id, label, hint, error, optional, children }: FieldProps & { id: string; children: ReactNode }) {
  const { t } = useI18n();
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">
        {label}
        {optional && <span className="ms-1 font-normal text-slate-400">({t("common.optional")})</span>}
      </label>
      {children}
      {error ? (
        <p className="mt-1 text-sm text-red-600">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-xs text-slate-500">{hint}</p>
      ) : null}
    </div>
  );
}

export function TextField({ label, hint, error, optional, ...rest }: FieldProps & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} optional={optional}>
      <input id={id} aria-invalid={!!error} className={inputClass(!!error)} {...rest} />
    </FieldShell>
  );
}

export function TextAreaField({ label, hint, error, optional, ...rest }: FieldProps & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useId();
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} optional={optional}>
      <textarea id={id} rows={4} aria-invalid={!!error} className={inputClass(!!error)} {...rest} />
    </FieldShell>
  );
}

export function SelectField({ label, hint, error, optional, children, ...rest }: FieldProps & SelectHTMLAttributes<HTMLSelectElement>) {
  const id = useId();
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} optional={optional}>
      <select id={id} aria-invalid={!!error} className={inputClass(!!error)} {...rest}>
        {children}
      </select>
    </FieldShell>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
      <input type="checkbox" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="relative h-6 w-11 rounded-full bg-slate-300 transition peer-checked:bg-brand-600 peer-focus-visible:ring-2 peer-focus-visible:ring-brand-600/40 after:absolute after:top-0.5 after:start-0.5 after:size-5 after:rounded-full after:bg-white after:transition peer-checked:after:translate-x-5 rtl:peer-checked:after:-translate-x-5" />
      {label}
    </label>
  );
}

// ---------------------------------------------------------------- feedback

export function Alert({ tone = "error", children }: { tone?: "error" | "success" | "info" | "warning"; children: ReactNode }) {
  const styles = {
    error: "bg-red-50 text-red-800 ring-red-200",
    success: "bg-emerald-50 text-emerald-800 ring-emerald-200",
    info: "bg-sky-50 text-sky-900 ring-sky-200",
    warning: "bg-amber-50 text-amber-900 ring-amber-200",
  }[tone];
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`rounded-lg px-3 py-2 text-sm ring-1 ${styles}`}>
      {children}
    </div>
  );
}

export function Badge({ tone = "slate", children }: { tone?: "slate" | "green" | "red" | "amber" | "brand"; children: ReactNode }) {
  const styles = {
    slate: "bg-slate-100 text-slate-700",
    green: "bg-emerald-100 text-emerald-800",
    red: "bg-red-100 text-red-800",
    amber: "bg-amber-100 text-amber-900",
    brand: "bg-brand-50 text-brand-800",
  }[tone];
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${styles}`}>{children}</span>;
}

export function Loading() {
  const { t } = useI18n();
  return <p className="py-10 text-center text-slate-500">{t("common.loading")}</p>;
}

export function Empty({ children }: { children?: ReactNode }) {
  const { t } = useI18n();
  return <p className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-slate-500">{children ?? t("common.empty")}</p>;
}

/** "Saved." message that disappears after a few seconds. */
export function useFlash(): [string | null, (msg: string) => void] {
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return [
    msg,
    (m: string) => {
      setMsg(m);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setMsg(null), 3000);
    },
  ];
}

// ---------------------------------------------------------------- dialogs

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-2xl p-0 shadow-xl backdrop:bg-slate-900/40"
    >
      <div className="p-5">
        <h2 className="mb-4 text-lg font-semibold">{title}</h2>
        {children}
      </div>
    </dialog>
  );
}

/** Shows a one-time password once, with a copy button. */
export function TemporaryPassword({ password }: { password: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-2 rounded-xl bg-amber-50 p-4 ring-1 ring-amber-200">
      <p className="text-sm font-medium text-amber-900">{t("password.temporary")}</p>
      <div className="flex items-center gap-2">
        <code dir="ltr" className="flex-1 rounded-md bg-white px-3 py-2 font-mono text-lg tracking-wider">
          {password}
        </code>
        <Button
          variant="secondary"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(password);
              setCopied(true);
            } catch {
              /* clipboard blocked: user can select the text */
            }
          }}
        >
          {copied ? "✓" : t("common.copy")}
        </Button>
      </div>
      <p className="text-xs text-amber-900">{t("password.temporaryHint")}</p>
    </div>
  );
}

// ---------------------------------------------------------------- formatting

export function useFormat() {
  const { locale } = useI18n();
  const tag = locale === "ar" ? "ar-SY-u-nu-latn" : "en-GB";
  return {
    dateTime: (v: string | number | null) =>
      v === null ? null : new Intl.DateTimeFormat(tag, { dateStyle: "medium", timeStyle: "short" }).format(new Date(v)),
    number: (n: number) => new Intl.NumberFormat(tag).format(n),
  };
}
