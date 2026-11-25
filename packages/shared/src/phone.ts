/**
 * Phone number normalisation to E.164.
 * Defaults to Syria (+963). Accepts local formats such as "0944 123 456",
 * "944123456", "00963944123456" and "+963 944 123 456".
 */
export function normalizePhone(input: string, defaultCountryCode = "963"): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const hasPlus = trimmed.startsWith("+");
  // Convert Arabic-Indic and Eastern Arabic-Indic digits too.
  const digits = trimmed
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[^\d]/g, "");
  if (!digits) return null;

  let national: string;
  let cc: string;
  if (hasPlus) {
    return isPlausibleE164(digits) ? `+${digits}` : null;
  } else if (digits.startsWith("00")) {
    const full = digits.slice(2);
    return isPlausibleE164(full) ? `+${full}` : null;
  } else if (digits.startsWith(defaultCountryCode) && digits.length > defaultCountryCode.length + 7) {
    cc = defaultCountryCode;
    national = digits.slice(defaultCountryCode.length);
  } else {
    cc = defaultCountryCode;
    national = digits.replace(/^0+/, "");
  }
  if (cc === "963" && !/^9\d{8}$/.test(national) && !/^[1-5]\d{6,8}$/.test(national)) {
    return null; // Syrian mobile: 9XXXXXXXX; landline: area code + number
  }
  const full = cc + national;
  return isPlausibleE164(full) ? `+${full}` : null;
}

function isPlausibleE164(digits: string): boolean {
  return /^[1-9]\d{7,14}$/.test(digits);
}

/** Digits only, without "+", as required by wa.me links. */
export function waNumber(e164: string): string {
  return e164.replace(/^\+/, "");
}
