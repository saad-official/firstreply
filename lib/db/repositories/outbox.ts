import "server-only";
import { and, asc, desc, eq, gte, type SQL } from "drizzle-orm";
import { getDb } from "../client";
import { outbox } from "../schema";
import type { OutboxAttachment, OutboxMessage } from "../types";
import { clampLimit } from "./shared";

export type InsertOutboxInput = {
  toEmail: string;
  subject: string;
  text: string;
  html?: string | null;
  /** Short message kind, e.g. "lead_reply", "booking_confirmation", "weekly_report". */
  kind?: string | null;
  leadId?: string | null;
  messageId?: string | null;
  attachments?: OutboxAttachment[];
  provider?: OutboxMessage["provider"];
  providerMessageId?: string | null;
  deliveredTo?: string | null;
  status?: OutboxMessage["status"];
};

export async function insert(orgId: string, input: InsertOutboxInput): Promise<OutboxMessage> {
  const db = await getDb();
  const [row] = await db
    .insert(outbox)
    .values({
      orgId,
      kind: input.kind ?? null,
      leadId: input.leadId ?? null,
      messageId: input.messageId ?? null,
      toEmail: input.toEmail,
      subject: input.subject,
      text: input.text,
      html: input.html ?? null,
      attachments: input.attachments ?? [],
      provider: input.provider ?? "outbox",
      providerMessageId: input.providerMessageId ?? null,
      deliveredTo: input.deliveredTo ?? null,
      status: input.status ?? "queued",
    })
    .returning();
  return row;
}

/** Newest first; optionally only one lead's mail. */
export async function listForOrg(
  orgId: string,
  options: { limit?: number; leadId?: string } = {},
): Promise<OutboxMessage[]> {
  const where: SQL[] = [eq(outbox.orgId, orgId)];
  if (options.leadId) where.push(eq(outbox.leadId, options.leadId));
  const db = await getDb();
  return db
    .select()
    .from(outbox)
    .where(and(...where))
    .orderBy(desc(outbox.createdAt), desc(outbox.id))
    .limit(clampLimit(options.limit));
}

export type OutboxUpdate = {
  status: OutboxMessage["status"];
  provider?: OutboxMessage["provider"];
  providerMessageId?: string | null;
  deliveredTo?: string | null;
};

export async function updateStatus(orgId: string, outboxId: string, update: OutboxUpdate): Promise<OutboxMessage | null> {
  const values: Partial<typeof outbox.$inferInsert> = { status: update.status };
  if (update.provider !== undefined) values.provider = update.provider;
  if (update.providerMessageId !== undefined) values.providerMessageId = update.providerMessageId;
  if (update.deliveredTo !== undefined) values.deliveredTo = update.deliveredTo;
  const db = await getDb();
  const [row] = await db
    .update(outbox)
    .set(values)
    .where(and(eq(outbox.id, outboxId), eq(outbox.orgId, orgId)))
    .returning();
  return row ?? null;
}

/** Failed deliveries created at or after `since`, every org, oldest first (cron retry). */
export async function listFailed(since: Date, options: { limit?: number } = {}): Promise<OutboxMessage[]> {
  const db = await getDb();
  return db
    .select()
    .from(outbox)
    .where(and(eq(outbox.status, "failed"), gte(outbox.createdAt, since)))
    .orderBy(asc(outbox.createdAt))
    .limit(clampLimit(options.limit, 50, 200));
}

/** True when a delivery of this message already failed (the daily retry owns it from then on). */
export async function hasFailedForMessage(orgId: string, messageId: string): Promise<boolean> {
  const db = await getDb();
  const [row] = await db
    .select({ id: outbox.id })
    .from(outbox)
    .where(and(eq(outbox.orgId, orgId), eq(outbox.messageId, messageId), eq(outbox.status, "failed")))
    .limit(1);
  return Boolean(row);
}
