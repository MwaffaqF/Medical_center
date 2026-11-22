import { LOCALES, type Locale } from "@mc/shared";

/** Validates the [locale] route parameter. */
export function localeParam(value: string | undefined): Locale | null {
  return LOCALES.includes(value as Locale) ? (value as Locale) : null;
}
