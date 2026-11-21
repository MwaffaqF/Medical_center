import { zValidator } from "@hono/zod-validator";
import type { ValidationTargets } from "hono";
import type { ZodType } from "zod";
import { ApiError } from "./errors";

/**
 * Request validation with a uniform error shape:
 * { error: { code: "validation_failed", fields: { path: message } } }
 * Pass `code` to hide details (e.g. on login).
 */
export const validate = <T extends ZodType, Target extends keyof ValidationTargets>(target: Target, schema: T, code?: string) =>
  zValidator(target, schema, (result) => {
    if (result.success) return;
    if (code) throw new ApiError(400, code);
    const fields: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const path = issue.path.join(".") || "_";
      fields[path] ??= issue.message;
    }
    throw new ValidationError(fields);
  });

export class ValidationError extends ApiError {
  constructor(readonly fields: Record<string, string>) {
    super(400, "validation_failed");
  }
}
