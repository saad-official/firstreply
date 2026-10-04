"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/components/app/action-result";
import { requireOrgContext } from "@/lib/auth/session";
import { zonedTimeToUtc } from "@/lib/domain/dates";
import { bookManually } from "@/lib/services/booking";
import { archiveLead, processLead } from "@/lib/services/intake";
import { SIMULATION_SCENARIOS, simulateLeadReply } from "@/lib/services/negotiation";
import { approveMessage, editAndApproveMessage, rejectMessage } from "@/lib/services/sending";
import { actionError, uuidSchema } from "../_lib/action-errors";

/**
 * Lead and draft actions shared by /leads/[id] and /queue. Every action
 * revalidates the whole signed-in shell (the Queue badge lives in the layout).
 */

function refresh() {
  revalidatePath("/", "layout");
}

function sendMessageText(status: "sent" | "failed" | "skipped"): string {
  if (status === "sent") return "Sent.";
  if (status === "failed") return "Approved, but delivery failed. It will be retried automatically.";
  return "Approved.";
}

export async function approveDraft(messageId: string): Promise<ActionResult> {
  const { user, org } = await requireOrgContext();
  const id = uuidSchema.safeParse(messageId);
  if (!id.success) return { ok: false, error: "Unknown draft." };
  try {
    const result = await approveMessage(org.id, id.data, user.id);
    refresh();
    return { ok: true, message: sendMessageText(result.send.status) };
  } catch (error) {
    return actionError(error, "approve draft");
  }
}

const EditSchema = z.object({
  messageId: uuidSchema,
  subject: z.string().trim().min(1, { error: "The subject cannot be empty." }).max(200),
  body: z.string().trim().min(1, { error: "The message cannot be empty." }).max(10_000),
});

export async function editAndApproveDraft(input: { messageId: string; subject: string; body: string }): Promise<ActionResult> {
  const { user, org } = await requireOrgContext();
  const parsed = EditSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the draft." };
  try {
    const result = await editAndApproveMessage(
      org.id,
      parsed.data.messageId,
      { subject: parsed.data.subject, body: parsed.data.body },
      user.id,
    );
    refresh();
    return { ok: true, message: sendMessageText(result.send.status) };
  } catch (error) {
    return actionError(error, "edit and approve draft");
  }
}

export async function rejectDraft(input: { messageId: string; reason?: string }): Promise<ActionResult> {
  const { user, org } = await requireOrgContext();
  const id = uuidSchema.safeParse(input.messageId);
  if (!id.success) return { ok: false, error: "Unknown draft." };
  try {
    await rejectMessage(org.id, id.data, user.id, input.reason?.slice(0, 500));
    refresh();
    return { ok: true, message: "Draft rejected." };
  } catch (error) {
    return actionError(error, "reject draft");
  }
}

export async function reprocessLead(leadId: string): Promise<ActionResult> {
  const { org } = await requireOrgContext();
  const id = uuidSchema.safeParse(leadId);
  if (!id.success) return { ok: false, error: "Unknown lead." };
  try {
    const result = await processLead(org.id, id.data, { force: true, actor: "user" });
    refresh();
    if (result.status === "skipped") return { ok: true, message: `Nothing to do: ${result.reason}.` };
    const what =
      result.action === "archive_spam"
        ? "Scored as spam and archived."
        : result.action === "draft_decline"
          ? "Drafted a polite decline."
          : result.autoSent
            ? "Drafted and sent a reply."
            : "Drafted a new reply.";
    return { ok: true, message: what };
  } catch (error) {
    return actionError(error, "re-process lead");
  }
}

export async function archiveLeadAction(leadId: string): Promise<ActionResult> {
  const { user, org } = await requireOrgContext();
  const id = uuidSchema.safeParse(leadId);
  if (!id.success) return { ok: false, error: "Unknown lead." };
  try {
    await archiveLead(org.id, id.data, user.id);
    refresh();
    return { ok: true, message: "Lead archived." };
  } catch (error) {
    return actionError(error, "archive lead");
  }
}

const SimulateSchema = z.object({ leadId: uuidSchema, scenario: z.enum(SIMULATION_SCENARIOS) });

const OUTCOME_TEXT: Record<string, string> = {
  book: "The lead accepted: meeting booked and confirmation sent.",
  counter: "The lead proposed another time: a counter-offer is waiting in the queue.",
  draft_answer: "The lead asked a question: it is waiting in the queue for your answer.",
  close: "The lead said no thanks: the lead is closed.",
  follow_up_later: "Out-of-office: a follow-up is scheduled for when they are back.",
  review: "The reply needs a human look: it is waiting in the queue.",
};

export async function simulateReply(input: { leadId: string; scenario: string }): Promise<ActionResult> {
  const { org } = await requireOrgContext();
  const parsed = SimulateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Pick a scenario." };
  try {
    const result = await simulateLeadReply(org.id, parsed.data.leadId, parsed.data.scenario);
    refresh();
    return { ok: true, message: OUTCOME_TEXT[result.action] ?? "Reply processed." };
  } catch (error) {
    return actionError(error, "simulate reply");
  }
}

const BookSchema = z.object({
  leadId: uuidSchema,
  /** datetime-local value, read in the workspace time zone. */
  when: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, { error: "Pick a date and time." }),
});

export async function bookManuallyAction(input: { leadId: string; when: string }): Promise<ActionResult> {
  const { user, org } = await requireOrgContext();
  const parsed = BookSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Pick a date and time." };
  const [date, time] = parsed.data.when.split("T");
  const [hour, minute] = time.split(":").map(Number);
  try {
    const startsAt = zonedTimeToUtc(date, hour, minute, org.timezone);
    await bookManually(org.id, parsed.data.leadId, startsAt, user.id);
    refresh();
    return { ok: true, message: "Booked. The confirmation and invite are on their way." };
  } catch (error) {
    return actionError(error, "book manually");
  }
}
