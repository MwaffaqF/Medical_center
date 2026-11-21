import { z } from "zod";
import { ROLES } from "./enums";

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const passwordSchema = z.string().min(10, "password_too_short").max(200);

export const sessionUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  role: z.enum(ROLES),
  centerId: z.string().nullable(),
  /** Set when a super admin is working inside a center in support mode. */
  supportCenterId: z.string().nullable(),
  preferredLocale: z.enum(["ar", "en"]),
});
export type SessionUser = z.infer<typeof sessionUserSchema>;

export type ApiError = { error: { code: string; message?: string } };
