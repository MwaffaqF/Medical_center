import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/** Throw from any handler; rendered as { error: { code } } with the given status. */
export class ApiError extends HTTPException {
  constructor(
    status: ContentfulStatusCode,
    readonly code: string,
    message?: string,
  ) {
    super(status, { message: message ?? code });
  }
}
