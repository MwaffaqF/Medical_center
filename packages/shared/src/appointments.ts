import type { AppointmentStatus } from "./enums";

/**
 * Appointment lifecycle (spec §7).
 *   pending ──► confirmed ──► checked_in ──► completed
 *      │            │               │
 *      │            └──► no_show    │
 *      └────────────┴───────────────┴──► cancelled
 * "reopen" brings a no-show or cancelled appointment back to confirmed (if the time is still free).
 */
export const STATUS_ACTIONS = ["confirm", "check_in", "complete", "no_show", "cancel", "reopen"] as const;
export type StatusAction = (typeof STATUS_ACTIONS)[number];

const TRANSITIONS: Record<StatusAction, { from: readonly AppointmentStatus[]; to: AppointmentStatus }> = {
  confirm: { from: ["pending"], to: "confirmed" },
  check_in: { from: ["pending", "confirmed"], to: "checked_in" },
  complete: { from: ["confirmed", "checked_in"], to: "completed" },
  no_show: { from: ["pending", "confirmed"], to: "no_show" },
  cancel: { from: ["pending", "confirmed", "checked_in"], to: "cancelled" },
  reopen: { from: ["no_show", "cancelled"], to: "confirmed" },
};

/** The status after an action, or null if the action isn't allowed from the current status. */
export function nextStatus(current: AppointmentStatus, action: StatusAction): AppointmentStatus | null {
  const t = TRANSITIONS[action];
  return t.from.includes(current) ? t.to : null;
}

/** Actions available from a status (for showing buttons). */
export function availableActions(current: AppointmentStatus): StatusAction[] {
  return STATUS_ACTIONS.filter((a) => TRANSITIONS[a].from.includes(current));
}

/**
 * Fills a WhatsApp template: "{patient_name}" → value. Unknown placeholders stay as they are,
 * so a typo in a template is visible rather than silently removed.
 */
export function renderTemplate(body: string, vars: Record<string, string | number | null | undefined>): string {
  return body.replace(/\{(\w+)\}/g, (m, key: string) => {
    const v = vars[key];
    return v === null || v === undefined || v === "" ? (key in vars ? "" : m) : String(v);
  });
}

/** wa.me click-to-chat link (spec §13). */
export function whatsappLink(e164: string, text: string): string {
  return `https://wa.me/${e164.replace(/^\+/, "")}?text=${encodeURIComponent(text)}`;
}
