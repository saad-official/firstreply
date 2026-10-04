import "server-only";
import { and, asc, eq, gte, lte } from "drizzle-orm";
import { getDb } from "../client";
import { availabilityRules, blackouts } from "../schema";
import type { AvailabilityRule, AvailabilityRuleInput, Blackout } from "../types";

/**
 * Weekly availability (local wall-clock time in organizations.timezone) and
 * blackout dates. Weekday 0 = Sunday .. 6 = Saturday; minutes after local
 * midnight, end exclusive.
 */

/** Mon-Fri 09:00-17:00, seeded for every new organization. */
export const DEFAULT_AVAILABILITY: readonly AvailabilityRuleInput[] = [1, 2, 3, 4, 5].map((weekday) => ({
  weekday,
  startMinute: 9 * 60,
  endMinute: 17 * 60,
}));

/** Throws a user-facing Error on an out-of-range or overlapping rule set. */
export function validateRules(rules: readonly AvailabilityRuleInput[]): AvailabilityRuleInput[] {
  const cleaned = rules.map((r) => ({ weekday: r.weekday, startMinute: r.startMinute, endMinute: r.endMinute }));
  for (const r of cleaned) {
    if (!Number.isInteger(r.weekday) || r.weekday < 0 || r.weekday > 6) {
      throw new Error("Weekday must be 0 (Sunday) to 6 (Saturday).");
    }
    if (
      !Number.isInteger(r.startMinute) ||
      !Number.isInteger(r.endMinute) ||
      r.startMinute < 0 ||
      r.endMinute > 1440 ||
      r.startMinute >= r.endMinute
    ) {
      throw new Error("Each availability window must start before it ends, within the day.");
    }
  }
  const sorted = [...cleaned].sort((a, b) => a.weekday - b.weekday || a.startMinute - b.startMinute);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (prev.weekday === cur.weekday && cur.startMinute < prev.endMinute) {
      throw new Error("Availability windows on the same day must not overlap.");
    }
  }
  return sorted;
}

export async function listRules(orgId: string): Promise<AvailabilityRule[]> {
  const db = await getDb();
  return db
    .select()
    .from(availabilityRules)
    .where(eq(availabilityRules.orgId, orgId))
    .orderBy(asc(availabilityRules.weekday), asc(availabilityRules.startMinute));
}

/** Replaces the whole weekly schedule atomically. An empty list means "no availability". */
export async function replaceRules(
  orgId: string,
  rules: readonly AvailabilityRuleInput[],
): Promise<AvailabilityRule[]> {
  const sorted = validateRules(rules);
  const db = await getDb();
  return db.transaction(async (tx) => {
    await tx.delete(availabilityRules).where(eq(availabilityRules.orgId, orgId));
    if (sorted.length === 0) return [];
    return tx
      .insert(availabilityRules)
      .values(sorted.map((r) => ({ orgId, ...r })))
      .returning();
  });
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function assertIsoDate(value: string): string {
  if (!ISO_DATE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new Error(`Invalid date: ${value} (expected YYYY-MM-DD).`);
  }
  // Date.parse rolls 2026-02-30 over; reject it instead.
  if (new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
    throw new Error(`Invalid date: ${value}.`);
  }
  return value;
}

/** Blackout dates, oldest first; `from` / `to` are inclusive "YYYY-MM-DD" bounds. */
export async function listBlackouts(
  orgId: string,
  range: { from?: string; to?: string } = {},
): Promise<Blackout[]> {
  const db = await getDb();
  const where = [eq(blackouts.orgId, orgId)];
  if (range.from) where.push(gte(blackouts.date, assertIsoDate(range.from)));
  if (range.to) where.push(lte(blackouts.date, assertIsoDate(range.to)));
  return db
    .select()
    .from(blackouts)
    .where(and(...where))
    .orderBy(asc(blackouts.date));
}

/** Idempotent per date: adding an existing date updates its reason. */
export async function addBlackout(orgId: string, date: string, reason?: string | null): Promise<Blackout> {
  const value = assertIsoDate(date);
  const db = await getDb();
  const [row] = await db
    .insert(blackouts)
    .values({ orgId, date: value, reason: reason?.trim() || null })
    .onConflictDoUpdate({
      target: [blackouts.orgId, blackouts.date],
      set: { reason: reason?.trim() || null },
    })
    .returning();
  return row;
}

export async function removeBlackout(orgId: string, blackoutId: string): Promise<boolean> {
  const db = await getDb();
  const rows = await db
    .delete(blackouts)
    .where(and(eq(blackouts.id, blackoutId), eq(blackouts.orgId, orgId)))
    .returning({ id: blackouts.id });
  return rows.length > 0;
}
