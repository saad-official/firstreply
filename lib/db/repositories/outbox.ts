import "server-only";
import { and, desc, eq, type SQL } from "drizzle-orm";
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
