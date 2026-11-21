import ar from "./ar.json";
import en from "./en.json";
import type { Locale } from "../enums";

export type MessageKey = keyof typeof en;
export const messages: Record<Locale, Record<MessageKey, string>> = { ar, en };

/** Translate a key, replacing {placeholders}. Falls back to the other language, then the key. */
export function t(locale: Locale, key: MessageKey, vars?: Record<string, string | number>): string {
  const raw = messages[locale][key] ?? messages[locale === "ar" ? "en" : "ar"][key] ?? key;
  return vars ? raw.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : raw;
}
