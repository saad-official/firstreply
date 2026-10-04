import "server-only";
import type { DraftResult } from "@/lib/ai/prompts/reply";
import * as messagesRepo from "@/lib/db/repositories/messages";
import * as slotOffersRepo from "@/lib/db/repositories/slotOffers";
import type { Actor, Lead, Message, MessageKind, Organization } from "@/lib/db/types";
import { firstNameOf } from "@/lib/domain/guardrails";
import { AUTO_REPLY_MIN_CONFIDENCE, AUTO_REPLY_MIN_SCORE } from "@/lib/domain/scoring";
import type { Slot } from "@/lib/domain/types";
import { isFallbackMeta } from "./fallbacks";
import { ANSWER_PLACEHOLDER_TEXT } from "./queue-constants";
import { audit, signatureFor } from "./shared";

/**
 * Helpers shared by intake, negotiation and maintenance for storing an
 * outbound draft (message + slot offers + audit event) and deciding whether
 * it may skip the approval queue.
 */

/** A starter draft the owner must complete; approving it unchanged is refused. */
export const ANSWER_PLACEHOLDER = ANSWER_PLACEHOLDER_TEXT;

/** Model rationale plus the guardrail findings, so the queue can say why a draft waits. */
export function composeRationale(result: DraftResult, fallbackReason: string | null): string {
  const parts = [result.draft.rationale.trim()];
  if (result.validation.violations.length > 0) {
    parts.push(`Checks failed: ${result.validation.violations.map((v) => v.message).join(" ")}`);
  }
  if (fallbackReason && !isFallbackMeta(result.meta)) parts.push(`(Fallback: ${fallbackReason})`);
  return parts.filter(Boolean).join(" ");
}

/**
 * Spec 3.2 step 4: Pro + autonomy on + high fit + score >= 70 + scorer
 * confidence >= 0.8, and the draft itself passed every guardrail with
 * confidence >= 0.8 (a template draft never qualifies).
 */
export function canAutoSend(
  org: Pick<Organization, "plan" | "autonomy">,
  lead: Pick<Lead, "fit" | "score">,
  scoreConfidence: number | null | undefined,
  result: DraftResult,
): boolean {
  return (
    org.plan === "pro" &&
    org.autonomy === "auto_high_score" &&
    lead.fit === "high" &&
    (lead.score ?? 0) >= AUTO_REPLY_MIN_SCORE &&
    (scoreConfidence ?? 0) >= AUTO_REPLY_MIN_CONFIDENCE &&
    result.validation.ok &&
    result.draft.confidence >= AUTO_REPLY_MIN_CONFIDENCE &&
    !isFallbackMeta(result.meta)
  );
}

export type SaveDraftInput = {
  kind: Exclude<MessageKind, "inbound">;
  result: DraftResult;
  fallbackReason: string | null;
  slots: readonly Slot[];
  actor: Actor;
};

/** Stores a model (or template) draft with its slot offers and logs `message.drafted`. */
export async function saveDraft(orgId: string, leadId: string, input: SaveDraftInput): Promise<Message> {
  const { result } = input;
  const message = await messagesRepo.create(orgId, {
    leadId,
    direction: "out",
    kind: input.kind,
    subject: result.draft.subject.trim().slice(0, 200),
    body: result.draft.body.trim(),
    status: "draft",
    confidence: result.draft.confidence,
    rationale: composeRationale(result, input.fallbackReason),
  });
  if (input.slots.length > 0) {
    await slotOffersRepo.createMany(
      orgId,
      message.id,
      input.slots.map((s) => ({ startsAt: s.start, endsAt: s.end })),
    );
  }
  await audit({
    orgId,
    actor: input.actor,
    type: "message.drafted",
    entityType: "message",
    entityId: message.id,
    input: { leadId, kind: input.kind, slots: input.slots.length },
    output: {
      confidence: result.draft.confidence,
      guardrailsOk: result.validation.ok,
      violations: result.validation.violations.map((v) => v.code),
      fallback: input.fallbackReason !== null,
    },
    meta: result.meta,
  });
  return message;
}

/** Starter draft for something only the owner can answer (a question, an unclear reply). */
export async function saveStarterDraft(
  org: Pick<Organization, "id" | "name" | "voice">,
  lead: Pick<Lead, "id" | "name">,
  input: { subject: string; why: string; actor: Actor },
): Promise<Message> {
  const first = firstNameOf(lead.name);
  const body = [first ? `Hi ${first},` : "Hi there,", "", ANSWER_PLACEHOLDER, "", "Best,", signatureFor(org)].join("\n");
  const message = await messagesRepo.create(org.id, {
    leadId: lead.id,
    direction: "out",
    kind: "question_answer",
    subject: input.subject.slice(0, 200),
    body,
    status: "draft",
    confidence: 0,
    rationale: `Needs you: ${input.why}`,
  });
  await audit({
    orgId: org.id,
    actor: input.actor,
    type: "message.needs_human",
    entityType: "message",
    entityId: message.id,
    input: { leadId: lead.id },
    output: { why: input.why },
  });
  return message;
}

/** "Re: <subject>" without stacking prefixes. */
export function replySubject(subject: string | null | undefined, fallback: string): string {
  const s = subject?.trim();
  if (!s) return fallback;
  return /^re:/i.test(s) ? s : `Re: ${s}`;
}
