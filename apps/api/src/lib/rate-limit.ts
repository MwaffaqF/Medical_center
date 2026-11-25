import { eq, sql } from "drizzle-orm";
import type { Database } from "../db/client";
import { rateLimits } from "../db/schema";

/**
 * Fixed-window counters stored in D1, used for failed-login throttling.
 * `hit` records one event and returns the count in the current window.
 */
export async function hit(db: Database, key: string, windowMs: number, now = Date.now()): Promise<number> {
  const cutoff = now - windowMs;
  const rows = await db
    .insert(rateLimits)
    .values({ key, count: 1, windowStart: new Date(now) })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        count: sql`CASE WHEN ${rateLimits.windowStart} < ${cutoff} THEN 1 ELSE ${rateLimits.count} + 1 END`,
        windowStart: sql`CASE WHEN ${rateLimits.windowStart} < ${cutoff} THEN ${now} ELSE ${rateLimits.windowStart} END`,
      },
    })
    .returning({ count: rateLimits.count });
  return rows[0]?.count ?? 1;
}

export async function current(db: Database, key: string, windowMs: number, now = Date.now()): Promise<number> {
  const row = await db.query.rateLimits.findFirst({ where: eq(rateLimits.key, key) });
  if (!row || row.windowStart.getTime() < now - windowMs) return 0;
  return row.count;
}

export async function clear(db: Database, key: string): Promise<void> {
  await db.delete(rateLimits).where(eq(rateLimits.key, key));
}
