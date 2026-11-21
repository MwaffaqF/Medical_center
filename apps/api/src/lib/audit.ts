import type { Context } from "hono";
import type { AppEnv } from "../env";
import { auditLog } from "../db/schema";

type AuditEntry = {
  entity: string;
  entityId?: string | null;
  action: string;
  changes?: Record<string, unknown>;
  /** Defaults to the request's center. Pass null for platform-level actions. */
  centerId?: string | null;
  /** Defaults to the signed-in user. */
  userId?: string | null;
};

export async function audit(c: Context<AppEnv>, entry: AuditEntry): Promise<void> {
  const user = c.get("user");
  await c.get("db").insert(auditLog).values({
    centerId: entry.centerId !== undefined ? entry.centerId : c.get("centerId"),
    userId: entry.userId !== undefined ? entry.userId : (user?.id ?? null),
    entity: entry.entity,
    entityId: entry.entityId ?? null,
    action: entry.action,
    changes: entry.changes,
    isSupportAction: user?.role === "super_admin" && !!user.supportCenterId,
    ip: c.req.header("cf-connecting-ip") ?? null,
    at: new Date(),
  });
}
