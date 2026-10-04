import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb } from "../client";
import { slotOffers } from "../schema";
import type { SlotOffer } from "../types";
import { assertMessageInOrg } from "./shared";

export type SlotInput = { startsAt: Date; endsAt: Date };

/** Stores the slots offered in an outbound message (usually three), earliest first. */
export async function createMany(
  orgId: string,
  messageId: string,
  slots: readonly SlotInput[],
): Promise<SlotOffer[]> {
  if (slots.length === 0) return [];
  for (const slot of slots) {
    if (!(slot.startsAt.getTime() < slot.endsAt.getTime())) throw new Error("A slot must start before it ends.");
  }
  const db = await getDb();
  await assertMessageInOrg(db, orgId, messageId);
  const rows = await db
    .insert(slotOffers)
    .values(slots.map((s) => ({ orgId, messageId, startsAt: s.startsAt, endsAt: s.endsAt })))
    .returning();
  return rows.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

/** Slots offered in a message, earliest first. */
export async function listForMessage(orgId: string, messageId: string): Promise<SlotOffer[]> {
  const db = await getDb();
  return db
    .select()
    .from(slotOffers)
    .where(and(eq(slotOffers.messageId, messageId), eq(slotOffers.orgId, orgId)))
    .orderBy(asc(slotOffers.startsAt));
}

export async function getById(orgId: string, slotOfferId: string): Promise<SlotOffer | null> {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(slotOffers)
    .where(and(eq(slotOffers.id, slotOfferId), eq(slotOffers.orgId, orgId)))
    .limit(1);
  return row ?? null;
}

/** Slots for several messages at once (lead thread view), keyed by message id, earliest first. */
export async function listForMessages(orgId: string, messageIds: readonly string[]): Promise<Map<string, SlotOffer[]>> {
  const out = new Map<string, SlotOffer[]>();
  if (messageIds.length === 0) return out;
  const db = await getDb();
  const rows = await db
    .select()
    .from(slotOffers)
    .where(and(eq(slotOffers.orgId, orgId), inArray(slotOffers.messageId, [...messageIds])))
    .orderBy(asc(slotOffers.startsAt));
  for (const row of rows) {
    const list = out.get(row.messageId) ?? [];
    list.push(row);
    out.set(row.messageId, list);
  }
  return out;
}

/** Replaces a message's offered slots (stale-draft refresh). */
export async function replaceForMessage(
  orgId: string,
  messageId: string,
  slots: readonly SlotInput[],
): Promise<SlotOffer[]> {
  const db = await getDb();
  await assertMessageInOrg(db, orgId, messageId);
  await db.delete(slotOffers).where(and(eq(slotOffers.messageId, messageId), eq(slotOffers.orgId, orgId)));
  return createMany(orgId, messageId, slots);
}
