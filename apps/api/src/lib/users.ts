import { eq } from "drizzle-orm";
import type { UserCreateInput } from "@mc/shared";
import type { Database } from "../db/client";
import { users } from "../db/schema";
import { ApiError } from "./errors";
import { hashPassword } from "./password";
import { revokeUserSessions } from "./session";

/** Readable one-time password, e.g. "kq7t-9xmd-a4hp". The user must change it at first sign-in. */
export function temporaryPassword(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789"; // no l/1/o/0/i
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const chars = [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`;
}

export type PublicUser = {
  id: string;
  centerId: string | null;
  name: string;
  email: string;
  role: (typeof users.$inferSelect)["role"];
  preferredLocale: "ar" | "en";
  isActive: boolean;
  mustChangePassword: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
};

export function publicUser(u: typeof users.$inferSelect): PublicUser {
  return {
    id: u.id,
    centerId: u.centerId,
    name: u.name,
    email: u.email,
    role: u.role,
    preferredLocale: u.preferredLocale,
    isActive: u.isActive,
    mustChangePassword: u.mustChangePassword,
    lastLoginAt: u.lastLoginAt,
    createdAt: u.createdAt,
  };
}

/** Creates a staff user with a temporary password (returned once, never stored in plain text). */
export async function createStaffUser(
  db: Database,
  centerId: string,
  input: Required<Pick<UserCreateInput, "name" | "email" | "role">> & { preferredLocale: "ar" | "en" },
) {
  const existing = await db.query.users.findFirst({ where: eq(users.email, input.email) });
  if (existing) throw new ApiError(409, "email_taken");
  const password = temporaryPassword();
  const [user] = await db
    .insert(users)
    .values({
      centerId,
      name: input.name,
      email: input.email,
      role: input.role,
      preferredLocale: input.preferredLocale,
      passwordHash: await hashPassword(password),
      mustChangePassword: true,
    })
    .returning();
  return { user: publicUser(user!), temporaryPassword: password };
}

/** Sets a new temporary password and signs the user out everywhere. */
export async function resetUserPassword(db: Database, userId: string) {
  const password = temporaryPassword();
  await db
    .update(users)
    .set({ passwordHash: await hashPassword(password), mustChangePassword: true })
    .where(eq(users.id, userId));
  await revokeUserSessions(db, userId);
  return password;
}
