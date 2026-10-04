import "server-only";
import { and, count, eq, gte, isNotNull, sql, type SQL } from "drizzle-orm";
import { getDb } from "../client";
import { LEAD_STATUSES, leads, meetings } from "../schema";
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

export type FirstResponseStats = {
  /** Leads created since `since` that have a first reply. */
  replied: number;
  /** Of those, how many were answered within `withinSeconds`. */
  withinTarget: number;
};

/** How many leads created since `since` were replied to, and how many within `withinSeconds` (default 60). */
export async function firstResponseStats(orgId: string, since: Date, withinSeconds = 60): Promise<FirstResponseStats> {
  const db = await getDb();
  const [row] = await db
    .select({
      replied: count(),
      withinTarget: sql<number | string>`count(*) filter (where extract(epoch from (${leads.firstReplyAt} - ${leads.createdAt})) <= ${withinSeconds})`,
    })
    .from(leads)
    .where(and(eq(leads.orgId, orgId), gte(leads.createdAt, since), isNotNull(leads.firstReplyAt)));
  return { replied: Number(row?.replied ?? 0), withinTarget: Number(row?.withinTarget ?? 0) };
}

/** Meetings booked (created) since `since`, excluding cancelled ones. */
export async function meetingsBookedSince(orgId: string, since: Date): Promise<number> {
  const db = await getDb();
  const [row] = await db
    .select({ n: count() })
    .from(meetings)
    .where(and(eq(meetings.orgId, orgId), gte(meetings.createdAt, since), sql`${meetings.status} <> 'cancelled'`));
  return Number(row?.n ?? 0);
}
