import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { DEFAULT_LOCALE, localeDir, messages, t as translate, type Locale, type MessageKey } from "@mc/shared";

type I18n = {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
  /** Translate a key built at runtime (e.g. `error.${code}`); returns `fallback` if the key doesn't exist. */
  tx: (key: string, fallback?: string) => string;
  /** Pick the Arabic or English value of a bilingual field, falling back to the other language. */
  pick: (ar: string | null | undefined, en: string | null | undefined) => string;
};

const I18nContext = createContext<I18n | null>(null);
const STORAGE_KEY = "mc.locale";

function readStoredLocale(): Locale {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "ar" || v === "en") return v;
  } catch {
    /* storage unavailable */
  }
  return DEFAULT_LOCALE;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(readStoredLocale);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = localeDir(locale);
    document.title = translate(locale, "app.name");
  }, [locale]);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      /* storage unavailable */
    }
  }, []);

  const value = useMemo<I18n>(
    () => ({
      locale,
      setLocale,
      t: (key, vars) => translate(locale, key, vars),
      tx: (key, fallback) => (key in messages[locale] ? translate(locale, key as MessageKey) : (fallback ?? key)),
      pick: (ar, en) => (locale === "ar" ? ar || en : en || ar) ?? "",
    }),
    [locale, setLocale],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n outside I18nProvider");
  return ctx;
}

export function LanguageSwitch({ className = "" }: { className?: string }) {
  const { locale, setLocale, t } = useI18n();
  return (
    <button
      type="button"
      onClick={() => setLocale(locale === "ar" ? "en" : "ar")}
      className={`rounded-md px-3 py-1.5 text-sm font-medium text-brand-700 hover:bg-brand-50 ${className}`}
    >
      {t("common.switchLanguage")}
    </button>
  );
}
