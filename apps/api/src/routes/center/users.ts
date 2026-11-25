import { and, eq } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { userCreateSchema, userUpdateSchema } from "@mc/shared";
import { users } from "../../db/schema";
import type { AppEnv } from "../../env";
import { audit } from "../../lib/audit";
import { ApiError } from "../../lib/errors";
import { revokeUserSessions } from "../../lib/session";
import { createStaffUser, publicUser, resetUserPassword } from "../../lib/users";
import { validate } from "../../lib/validate";
import { centerOf, requireAuth } from "../../middleware/auth";

/** Staff accounts of the manager's own center. Spec §11.10. */
export const centerUserRoutes = new Hono<AppEnv>()
  .use("*", requireAuth("manager"))

  .get("/", async (c) => {
    const rows = await c.get("db").query.users.findMany({
      where: eq(users.centerId, centerOf(c)),
      orderBy: [users.role, users.name],
    });
    return c.json({ users: rows.map(publicUser) });
  })

  .post("/", validate("json", userCreateSchema), async (c) => {
    const input = c.req.valid("json");
    const result = await createStaffUser(c.get("db"), centerOf(c), input);
    await audit(c, { entity: "user", entityId: result.user.id, action: "create", changes: { email: input.email, role: input.role } });
    return c.json(result, 201);
  })

  .patch("/:id", validate("json", userUpdateSchema), async (c) => {
    const db = c.get("db");
    const target = await findTarget(c);
    const input = c.req.valid("json");
    const self = target.id === c.get("user")!.id;
    if (self && (input.isActive === false || (input.role && input.role !== target.role))) {
      throw new ApiError(400, "cannot_change_own_access");
    }
    const [user] = await db.update(users).set(input).where(eq(users.id, target.id)).returning();
    if (input.isActive === false) await revokeUserSessions(db, target.id);
    await audit(c, { entity: "user", entityId: target.id, action: "update", changes: input });
    return c.json({ user: publicUser(user!) });
  })

  .post("/:id/reset-password", async (c) => {
    const target = await findTarget(c);
    if (target.id === c.get("user")!.id) throw new ApiError(400, "use_change_password");
    const temporaryPassword = await resetUserPassword(c.get("db"), target.id);
    await audit(c, { entity: "user", entityId: target.id, action: "password_reset" });
    return c.json({ temporaryPassword });
  });

async function findTarget(c: Context<AppEnv>) {
  const target = await c.get("db").query.users.findFirst({
    where: and(eq(users.id, c.req.param("id")!), eq(users.centerId, centerOf(c))),
  });
  if (!target || target.role === "super_admin") throw new ApiError(404, "not_found");
  return target;
}
