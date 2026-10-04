import "server-only";
import { and, asc, eq, gt, gte, lt, ne, type SQL } from "drizzle-orm";
import { getDb } from "../client";
import { meetings } from "../schema";
import type { BusyInterval, Meeting, MeetingStatus } from "../types";
import { assertLeadInOrg, clampLimit, isUniqueViolation } from "./shared";

/** The requested time overlaps an existing booking. */
export class SlotUnavailableError extends Error {
  constructor() {
    super("That time is no longer available.");
    this.name = "SlotUnavailableError";
  }
}

/** Statuses that occupy calendar time (everything except cancelled). */
const NOT_CANCELLED = ne(meetings.status, "cancelled");

export type CreateMeetingInput = {
  leadId: string;
  startsAt: Date;
  endsAt: Date;
  /** Defaults to "<uuid>@firstreply". */
  icsUid?: string;
};

/**
 * Books a meeting. Throws SlotUnavailableError when [startsAt, endsAt)
 * overlaps another non-cancelled meeting of the org (checked in the
 * transaction; the partial unique index on (org_id, starts_at) for booked
 * meetings is the race backstop).
 */
export async function create(orgId: string, input: CreateMeetingInput): Promise<Meeting> {
  if (!(input.startsAt.getTime() < input.endsAt.getTime())) throw new Error("A meeting must start before it ends.");
  const icsUid = input.icsUid ?? `${globalThis.crypto.randomUUID()}@firstreply`;
  const db = await getDb();
  await assertLeadInOrg(db, orgId, input.leadId);
  try {
    return await db.transaction(async (tx) => {
      const [clash] = await tx
        .select({ id: meetings.id })
        .from(meetings)
        .where(
          and(
            eq(meetings.orgId, orgId),
            NOT_CANCELLED,
            lt(meetings.startsAt, input.endsAt),
            gt(meetings.endsAt, input.startsAt),
          ),
        )
        .limit(1);
      if (clash) throw new SlotUnavailableError();
      const [row] = await tx
        .insert(meetings)
        .values({ orgId, leadId: input.leadId, startsAt: input.startsAt, endsAt: input.endsAt, icsUid })
        .returning();
      return row;
    });
  } catch (error) {
    if (isUniqueViolation(error, "meetings_org_starts_booked_key")) throw new SlotUnavailableError();
    throw error;
  }
}

export async function getById(orgId: string, meetingId: string): Promise<Meeting | null> {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(meetings)
    .where(and(eq(meetings.id, meetingId), eq(meetings.orgId, orgId)))
    .limit(1);
  return row ?? null;
}

export type ListMeetingsOptions = {
  /** Meetings starting at or after. */
  from?: Date;
  /** Meetings starting before. */
  to?: Date;
  status?: MeetingStatus;
  limit?: number;
};

/** Earliest first. */
export async function listForOrg(orgId: string, options: ListMeetingsOptions = {}): Promise<Meeting[]> {
  const where: SQL[] = [eq(meetings.orgId, orgId)];
  if (options.from) where.push(gte(meetings.startsAt, options.from));
  if (options.to) where.push(lt(meetings.startsAt, options.to));
  if (options.status) where.push(eq(meetings.status, options.status));
  const db = await getDb();
  return db
    .select()
    .from(meetings)
    .where(and(...where))
    .orderBy(asc(meetings.startsAt))
    .limit(clampLimit(options.limit, 200, 1000));
}

export async function listForLead(orgId: string, leadId: string): Promise<Meeting[]> {
  const db = await getDb();
  return db
    .select()
    .from(meetings)
    .where(and(eq(meetings.leadId, leadId), eq(meetings.orgId, orgId)))
    .orderBy(asc(meetings.startsAt));
}

/** Busy intervals overlapping [from, to): every non-cancelled meeting, earliest first. */
export async function listBusy(orgId: string, from: Date, to: Date): Promise<BusyInterval[]> {
  const db = await getDb();
  return db
    .select({ startsAt: meetings.startsAt, endsAt: meetings.endsAt })
    .from(meetings)
    .where(and(eq(meetings.orgId, orgId), NOT_CANCELLED, lt(meetings.startsAt, to), gt(meetings.endsAt, from)))
    .orderBy(asc(meetings.startsAt));
}

export async function updateStatus(orgId: string, meetingId: string, status: MeetingStatus): Promise<Meeting | null> {
  const db = await getDb();
  const [row] = await db
    .update(meetings)
    .set({ status })
    .where(and(eq(meetings.id, meetingId), eq(meetings.orgId, orgId)))
    .returning();
  return row ?? null;
}

/** ICS UIDs are globally unique; pass `orgId` to also require tenancy. */
export async function getByIcsUid(icsUid: string, orgId?: string): Promise<Meeting | null> {
  if (!icsUid || icsUid.length > 255) return null;
  const db = await getDb();
  const where = orgId ? and(eq(meetings.icsUid, icsUid), eq(meetings.orgId, orgId)) : eq(meetings.icsUid, icsUid);
  const [row] = await db.select().from(meetings).where(where).limit(1);
  return row ?? null;
}
