import "server-only";
import { and, count, eq, gte, isNotNull, sql, type SQL } from "drizzle-orm";
import { getDb } from "../client";
import { LEAD_STATUSES, leads } from "../schema";
import type { LeadStatus } from "../types";

/**
 * Median seconds from lead creation to its first outbound reply, over leads
 * created at or after `since` that have been replied to. Null when none have.
 */
export async function medianFirstResponseSeconds(orgId: string, since: Date): Promise<number | null> {
  const db = await getDb();
  const [row] = await db
    .select({
      median: sql<number | string | null>`percentile_cont(0.5) within group (order by extract(epoch from (${leads.firstReplyAt} - ${leads.createdAt})))`,
    })
    .from(leads)
    .where(and(eq(leads.orgId, orgId), gte(leads.createdAt, since), isNotNull(leads.firstReplyAt)));
  const value = row?.median;
  if (value === null || value === undefined) return null;
  const seconds = Number(value);
  return Number.isFinite(seconds) ? seconds : null;
}

/** Lead counts per status (every status present, zero-filled); optionally only leads created since. */
export async function countsByStatus(
  orgId: string,
  options: { since?: Date } = {},
): Promise<Record<LeadStatus, number>> {
  const where: SQL[] = [eq(leads.orgId, orgId)];
  if (options.since) where.push(gte(leads.createdAt, options.since));
  const db = await getDb();
  const rows = await db
    .select({ status: leads.status, n: count() })
    .from(leads)
    .where(and(...where))
    .groupBy(leads.status);
  const counts = Object.fromEntries(LEAD_STATUSES.map((s) => [s, 0])) as Record<LeadStatus, number>;
  for (const row of rows) counts[row.status] = Number(row.n);
  return counts;
}
