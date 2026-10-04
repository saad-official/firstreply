import "server-only";
import { and, asc, count, eq, inArray } from "drizzle-orm";
import { getDb } from "../client";
import { leads, messages } from "../schema";
import type { Lead, Message, MessageClassification, MessageDirection, MessageKind, MessageStatus } from "../types";
import { assertLeadInOrg, clampLimit } from "./shared";

/**
 * Lead thread. Outbound: draft -> approved -> sent, or draft -> rejected
 * (auto-send goes draft -> sent). Inbound: always `received`, kind `inbound`.
 */

export type CreateMessageInput = {
  leadId: string;
  direction: MessageDirection;
  /** Must be "inbound" for direction "in" and anything else for "out". Defaults to "inbound" / "reply". */
  kind?: MessageKind;
  subject?: string;
  body: string;
  /** Defaults to "received" (in) or "draft" (out). */
  status?: MessageStatus;
  confidence?: number | null;
  rationale?: string | null;
  classification?: MessageClassification | null;
  simulated?: boolean;
  sentAt?: Date | null;
  /** Backdating for demo data and tests. */
  createdAt?: Date;
};

export async function create(orgId: string, input: CreateMessageInput): Promise<Message> {
  const inbound = input.direction === "in";
  const kind = input.kind ?? (inbound ? "inbound" : "reply");
  if (inbound !== (kind === "inbound")) {
    throw new Error(`Message kind "${kind}" does not match direction "${input.direction}".`);
  }
  const status = input.status ?? (inbound ? "received" : "draft");
  if (inbound !== (status === "received")) {
    throw new Error(`Message status "${status}" does not match direction "${input.direction}".`);
  }
  const db = await getDb();
  await assertLeadInOrg(db, orgId, input.leadId);
  const [row] = await db
    .insert(messages)
    .values({
      orgId,
      leadId: input.leadId,
      direction: input.direction,
      kind,
      subject: input.subject ?? "",
      body: input.body,
      status,
      confidence: input.confidence ?? null,
      rationale: input.rationale ?? null,
      classification: input.classification ?? null,
      simulated: input.simulated ?? false,
      sentAt: input.sentAt ?? null,
      ...(input.createdAt ? { createdAt: input.createdAt, updatedAt: input.createdAt } : {}),
    })
    .returning();
  return row;
}

export async function getById(orgId: string, messageId: string): Promise<Message | null> {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(messages)
    .where(and(eq(messages.id, messageId), eq(messages.orgId, orgId)))
    .limit(1);
  return row ?? null;
}

/** The lead's thread, oldest first. */
export async function listForLead(orgId: string, leadId: string): Promise<Message[]> {
  const db = await getDb();
  return db
    .select()
    .from(messages)
    .where(and(eq(messages.leadId, leadId), eq(messages.orgId, orgId)))
    .orderBy(asc(messages.createdAt), asc(messages.id));
}

export type QueueLead = Pick<Lead, "id" | "name" | "email" | "company" | "status" | "score" | "fit" | "createdAt">;
export type QueueItem = { message: Message; lead: QueueLead };

/** Approval queue: outbound drafts, oldest first (the lead waiting longest comes first). */
export async function listQueue(orgId: string, options: { limit?: number } = {}): Promise<QueueItem[]> {
  const db = await getDb();
  return db
    .select({
      message: messages,
      lead: {
        id: leads.id,
        name: leads.name,
        email: leads.email,
        company: leads.company,
        status: leads.status,
        score: leads.score,
        fit: leads.fit,
        createdAt: leads.createdAt,
      },
    })
    .from(messages)
    .innerJoin(leads, eq(leads.id, messages.leadId))
    .where(and(eq(messages.orgId, orgId), eq(messages.status, "draft"), eq(messages.direction, "out")))
    .orderBy(asc(messages.createdAt), asc(messages.id))
    .limit(clampLimit(options.limit, 100, 500));
}

/** Outbound drafts waiting for approval (the app-shell badge). */
export async function countAwaitingApproval(orgId: string): Promise<number> {
  const db = await getDb();
  const [row] = await db
    .select({ n: count() })
    .from(messages)
    .where(and(eq(messages.orgId, orgId), eq(messages.status, "draft"), eq(messages.direction, "out")));
  return row?.n ?? 0;
}

/**
 * Unconditional status write (no transition check). Prefer approve, reject
 * and markSent, which only move a message out of the states they expect.
 */
export async function updateStatus(orgId: string, messageId: string, status: MessageStatus): Promise<Message | null> {
  const db = await getDb();
  const [row] = await db
    .update(messages)
    .set({ status })
    .where(and(eq(messages.id, messageId), eq(messages.orgId, orgId)))
    .returning();
  return row ?? null;
}

export type ReviewInput = {
  /** The reviewing user (null for system actions). */
  userId?: string | null;
  now?: Date;
};

/**
 * draft -> approved, optionally saving the reviewer's edits. Null when the
 * message is not an outbound draft in this org (already handled, or unknown).
 */
export async function approve(
  orgId: string,
  messageId: string,
  input: ReviewInput & { subject?: string; body?: string } = {},
): Promise<Message | null> {
  const values: Partial<typeof messages.$inferInsert> = {
    status: "approved",
    reviewedBy: input.userId ?? null,
    reviewedAt: input.now ?? new Date(),
  };
  if (input.subject !== undefined) values.subject = input.subject;
  if (input.body !== undefined) {
    if (!input.body.trim()) throw new Error("The message body cannot be empty.");
    values.body = input.body;
  }
  const db = await getDb();
  const [row] = await db
    .update(messages)
    .set(values)
    .where(
      and(
        eq(messages.id, messageId),
        eq(messages.orgId, orgId),
        eq(messages.direction, "out"),
        eq(messages.status, "draft"),
      ),
    )
    .returning();
  return row ?? null;
}

/** draft -> rejected. Null when the message is not an outbound draft in this org. */
export async function reject(orgId: string, messageId: string, input: ReviewInput = {}): Promise<Message | null> {
  const db = await getDb();
  const [row] = await db
    .update(messages)
    .set({ status: "rejected", reviewedBy: input.userId ?? null, reviewedAt: input.now ?? new Date() })
    .where(
      and(
        eq(messages.id, messageId),
        eq(messages.orgId, orgId),
        eq(messages.direction, "out"),
        eq(messages.status, "draft"),
      ),
    )
    .returning();
  return row ?? null;
}

/**
 * draft | approved -> sent (straight from draft for auto-send). Null when the
 * message is not an unsent outbound message in this org, so a double send
 * cannot happen.
 */
export async function markSent(orgId: string, messageId: string, sentAt: Date = new Date()): Promise<Message | null> {
  const db = await getDb();
  const [row] = await db
    .update(messages)
    .set({ status: "sent", sentAt })
    .where(
      and(
        eq(messages.id, messageId),
        eq(messages.orgId, orgId),
        eq(messages.direction, "out"),
        inArray(messages.status, ["draft", "approved"]),
      ),
    )
    .returning();
  return row ?? null;
}

/** Stores the negotiation classifier's output on an inbound message. */
export async function setClassification(
  orgId: string,
  messageId: string,
  classification: MessageClassification,
): Promise<Message | null> {
  const db = await getDb();
  const [row] = await db
    .update(messages)
    .set({ classification })
    .where(and(eq(messages.id, messageId), eq(messages.orgId, orgId), eq(messages.direction, "in")))
    .returning();
  return row ?? null;
}
