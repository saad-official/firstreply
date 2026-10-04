import "server-only";
import * as leadsRepo from "@/lib/db/repositories/leads";
import * as meetingsRepo from "@/lib/db/repositories/meetings";
import * as messagesRepo from "@/lib/db/repositories/messages";
import * as organizationsRepo from "@/lib/db/repositories/organizations";
import * as outboxRepo from "@/lib/db/repositories/outbox";
import type { Lead, LeadStatus, Message, Organization, OutboxAttachment, OutboxMessage } from "@/lib/db/types";
import { buildIcs } from "@/lib/domain/ics";
import { getEmailProvider, type EmailProvider } from "@/lib/email/provider";
import { ANSWER_PLACEHOLDER } from "./drafting";
import { NotFoundError, ServiceError } from "./errors";
import { appOrigin, audit, errorText, nowFrom, offerFor, textToHtml, type ServiceDeps } from "./shared";

/**
 * Outbound mail (spec 3.4 / 3.6). A message is claimed by moving it to
 * "sent" before the provider call (messages.markSent only moves unsent
 * messages), so two workers can never deliver it twice; a provider failure
 * reverts it to "approved" and marks the outbox row failed, and the daily job
 * retries that row.
 */

function provider(deps?: ServiceDeps): EmailProvider {
  return deps?.emailProvider ?? getEmailProvider();
}

/** Lead status after a message of this kind is sent; null leaves it unchanged. */
function statusAfterSend(kind: Message["kind"], current: LeadStatus): LeadStatus | null {
  const closed: LeadStatus[] = ["booked", "declined", "spam", "archived"];
  switch (kind) {
    case "reply":
      return current === "new" ? "replied" : null;
    case "decline":
      return current === "booked" ? null : "declined";
    case "counter":
    case "question_answer":
      return closed.includes(current) ? null : "negotiating";
    case "confirmation":
      return "booked";
    default:
      return null;
  }
}

function organizerAddress(): string {
  try {
    return `bookings@${new URL(appOrigin()).hostname}`;
  } catch {
    return "bookings@firstreply.app";
  }
}

/** The .ics invite for a confirmation: the lead's most recent booked meeting. */
async function confirmationAttachments(
  org: Organization,
  lead: Lead,
  now: Date,
): Promise<OutboxAttachment[]> {
  const meetings = await meetingsRepo.listForLead(org.id, lead.id);
  const meeting = meetings.filter((m) => m.status === "booked").at(-1);
  if (!meeting) return [];
  const ics = buildIcs({
    uid: meeting.icsUid,
    start: meeting.startsAt,
    end: meeting.endsAt,
    summary: `${org.name} and ${lead.name ?? lead.email}`,
    description: `${offerFor(org)}. Booked with Firstreply.`,
    organizerEmail: organizerAddress(),
    organizerName: org.name,
    attendeeEmail: lead.email,
    attendeeName: lead.name ?? undefined,
    now,
  });
  return [{ filename: "invite.ics", contentType: "text/calendar; charset=utf-8; method=REQUEST", content: ics }];
}

/** Sends one stored outbox row through the provider and records the result. */
async function deliver(row: OutboxMessage, deps?: ServiceDeps): Promise<{ ok: boolean; error?: string }> {
  const p = provider(deps);
  try {
    const result = await p.send({
      to: row.toEmail,
      subject: row.subject,
      text: row.text,
      html: row.html ?? undefined,
      attachments: row.attachments,
    });
    await outboxRepo.updateStatus(row.orgId, row.id, {
      status: "sent",
      provider: result.provider,
      providerMessageId: result.providerMessageId,
      deliveredTo: result.deliveredTo,
    });
    return { ok: true };
  } catch (error) {
    await outboxRepo.updateStatus(row.orgId, row.id, { status: "failed", provider: p.name });
    return { ok: false, error: errorText(error) };
  }
}

async function afterSent(org: Organization, lead: Lead, message: Message, sentAt: Date): Promise<void> {
  if (message.kind !== "confirmation") await leadsRepo.setFirstReplyAt(org.id, lead.id, sentAt);
  const next = statusAfterSend(message.kind, lead.status);
  if (next && next !== lead.status) await leadsRepo.updateStatus(org.id, lead.id, next);
}

export type SendOutcome = { status: "sent" | "failed" | "skipped"; reason?: string };

/** Delivers one approved message. Idempotent: an already-sent or unapproved message is skipped. */
export async function sendMessage(orgId: string, messageId: string, deps?: ServiceDeps): Promise<SendOutcome> {
  const message = await messagesRepo.getById(orgId, messageId);
  if (!message) throw new NotFoundError("Message");
  if (message.direction !== "out" || message.status !== "approved") {
    return { status: "skipped", reason: `message is ${message.status}` };
  }
  const [org, lead] = await Promise.all([
    organizationsRepo.getById(orgId),
    leadsRepo.getById(orgId, message.leadId),
  ]);
  if (!org || !lead) throw new NotFoundError("Lead");

  const now = nowFrom(deps);
  const claimed = await messagesRepo.markSent(orgId, messageId, now);
  if (!claimed) return { status: "skipped", reason: "already claimed" };

  const attachments = message.kind === "confirmation" ? await confirmationAttachments(org, lead, now) : [];
  const row = await outboxRepo.insert(orgId, {
    kind: message.kind === "confirmation" ? "booking_confirmation" : `lead_${message.kind}`,
    leadId: lead.id,
    messageId: message.id,
    toEmail: lead.email,
    subject: message.subject || `Message from ${org.name}`,
    text: message.body,
    html: textToHtml(message.body),
    attachments,
    provider: provider(deps).name,
  });
  const delivery = await deliver(row, deps);
  if (!delivery.ok) {
    await messagesRepo.revertToApproved(orgId, messageId);
    await audit({
      orgId,
      actor: "system",
      type: "message.send_failed",
      entityType: "message",
      entityId: messageId,
      output: { error: delivery.error ?? "unknown" },
    });
    return { status: "failed", reason: delivery.error };
  }
  await afterSent(org, lead, claimed, now);
  await audit({
    orgId,
    actor: "system",
    type: "message.sent",
    entityType: "message",
    entityId: messageId,
    input: { leadId: lead.id, kind: message.kind },
    output: { outboxId: row.id, provider: row.provider, attachments: attachments.length },
  });
  return { status: "sent" };
}

/**
 * Re-delivers a failed outbox row (daily job). Re-claims its message first so
 * a retry cannot race a fresh send.
 */
export async function retryOutboxRow(row: OutboxMessage, deps?: ServiceDeps): Promise<SendOutcome> {
  const now = nowFrom(deps);
  let message: Message | null = null;
  if (row.messageId) {
    message = await messagesRepo.markSent(row.orgId, row.messageId, now);
    if (!message) return { status: "skipped", reason: "message no longer approved" };
  }
  const delivery = await deliver(row, deps);
  if (!delivery.ok) {
    if (message) await messagesRepo.revertToApproved(row.orgId, message.id);
    return { status: "failed", reason: delivery.error };
  }
  if (message) {
    const [org, lead] = await Promise.all([
      organizationsRepo.getById(row.orgId),
      leadsRepo.getById(row.orgId, message.leadId),
    ]);
    if (org && lead) await afterSent(org, lead, message, now);
  }
  await audit({
    orgId: row.orgId,
    actor: "cron",
    type: "message.resent",
    entityType: row.messageId ? "message" : undefined,
    entityId: row.messageId,
    output: { outboxId: row.id },
  });
  return { status: "sent" };
}

export type SendSummary = { sent: number; failed: number; skipped: number };

/**
 * Sends every approved message for one org, or (cron) all orgs. Messages
 * whose delivery already failed are left to the daily retry.
 */
export async function sendApprovedMessages(orgId?: string, deps?: ServiceDeps): Promise<SendSummary> {
  const summary: SendSummary = { sent: 0, failed: 0, skipped: 0 };
  const approved = await messagesRepo.listApproved({ orgId, limit: 100 });
  for (const message of approved) {
    if (await outboxRepo.hasFailedForMessage(message.orgId, message.id)) {
      summary.skipped += 1;
      continue;
    }
    try {
      const outcome = await sendMessage(message.orgId, message.id, deps);
      summary[outcome.status] += 1;
    } catch (error) {
      console.error("[sending] message", message.id, errorText(error));
      summary.failed += 1;
    }
  }
  return summary;
}

/* ------------------------------------------------------------------ */
/* Owner actions                                                       */
/* ------------------------------------------------------------------ */

function assertComplete(body: string): void {
  if (body.includes(ANSWER_PLACEHOLDER)) {
    throw new ServiceError("invalid_input", `Replace "${ANSWER_PLACEHOLDER}" with your answer before sending.`);
  }
}

export type ReviewResult = { message: Message; send: SendOutcome };

/** Approve a draft as written and send it now. */
export async function approveMessage(
  orgId: string,
  messageId: string,
  userId: string | null,
  deps?: ServiceDeps,
): Promise<ReviewResult> {
  const current = await messagesRepo.getById(orgId, messageId);
  if (!current) throw new NotFoundError("Message");
  assertComplete(current.body);
  const approved = await messagesRepo.approve(orgId, messageId, { userId, now: nowFrom(deps) });
  if (!approved) throw new ServiceError("conflict", "This draft was already handled.");
  await audit({
    orgId,
    actor: "user",
    type: "message.approved",
    entityType: "message",
    entityId: messageId,
    input: { leadId: approved.leadId, edited: false },
  });
  return { message: approved, send: await sendMessage(orgId, messageId, deps) };
}

/** Save the owner's edits, approve and send. */
export async function editAndApproveMessage(
  orgId: string,
  messageId: string,
  edit: { subject: string; body: string },
  userId: string | null,
  deps?: ServiceDeps,
): Promise<ReviewResult> {
  const subject = edit.subject.trim();
  const body = edit.body.trim();
  if (!subject) throw new ServiceError("invalid_input", "The subject cannot be empty.");
  if (!body) throw new ServiceError("invalid_input", "The message cannot be empty.");
  if (body.length > 10_000) throw new ServiceError("invalid_input", "Keep the message under 10,000 characters.");
  assertComplete(body);
  const approved = await messagesRepo.approve(orgId, messageId, { userId, subject, body, now: nowFrom(deps) });
  if (!approved) throw new ServiceError("conflict", "This draft was already handled.");
  await audit({
    orgId,
    actor: "user",
    type: "message.approved",
    entityType: "message",
    entityId: messageId,
    input: { leadId: approved.leadId, edited: true },
  });
  return { message: approved, send: await sendMessage(orgId, messageId, deps) };
}

/**
 * Reject a draft. The optional reason is kept in the audit trail and fed to
 * the drafter as owner feedback when the lead is processed again.
 */
export async function rejectMessage(
  orgId: string,
  messageId: string,
  userId: string | null,
  reason?: string | null,
  deps?: ServiceDeps,
): Promise<Message> {
  const rejected = await messagesRepo.reject(orgId, messageId, { userId, now: nowFrom(deps) });
  if (!rejected) throw new ServiceError("conflict", "This draft was already handled.");
  await audit({
    orgId,
    actor: "user",
    type: "message.rejected",
    entityType: "lead",
    entityId: rejected.leadId,
    input: { messageId, reason: reason?.trim().slice(0, 500) || null },
  });
  return rejected;
}
