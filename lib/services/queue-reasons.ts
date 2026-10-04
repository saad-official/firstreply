import type { Lead, Message, Organization } from "@/lib/db/types";
import { PRICING_PATTERNS } from "@/lib/domain/guardrails";
import { AUTO_REPLY_MIN_CONFIDENCE, AUTO_REPLY_MIN_SCORE } from "@/lib/domain/scoring";
import { ANSWER_PLACEHOLDER_TEXT } from "./queue-constants";

/**
 * Why a draft is waiting in the approval queue, in the owner's words, and
 * whether it would have gone out on its own on Pro with auto-reply on (spec
 * 3.2 step 4). Pure: safe for server components and tests.
 */

export type WaitReason = { code: string; text: string };

export type QueueExplanation = {
  reasons: WaitReason[];
  /** Pro + auto-reply would have sent this without asking. */
  couldAutoSendOnPro: boolean;
};

type ExplainMessage = Pick<Message, "kind" | "confidence" | "rationale" | "body">;
type ExplainLead = Pick<Lead, "score" | "fit" | "message"> & { scoreConfidence?: number | null };
type ExplainOrg = Pick<Organization, "plan" | "autonomy">;

/** Lead-side pricing questions the reply guardrail patterns do not cover ("how much do you charge"). */
const LEAD_PRICING = /\b(?:how much|charges?|charging|rates?|ballpark|estimate|budget for|what (?:would|does) it cost)\b/i;

export function mentionsPricing(text: string): boolean {
  return LEAD_PRICING.test(text) || PRICING_PATTERNS.some(({ pattern }) => pattern.test(text));
}

export function explainWait(message: ExplainMessage, lead: ExplainLead, org: ExplainOrg): QueueExplanation {
  const reasons: WaitReason[] = [];
  const add = (code: string, text: string) => reasons.push({ code, text });
  const confidence = message.confidence ?? 0;
  const rationale = message.rationale ?? "";

  if (message.kind === "decline") add("decline", "It is a decline: turning a lead away always waits for you.");
  if (message.kind === "question_answer") {
    add(
      "needs_you",
      message.body.includes(ANSWER_PLACEHOLDER_TEXT)
        ? "The lead asked something only you can answer. Write the answer before sending."
        : "The lead's reply needs a human answer.",
    );
  }
  if (message.kind === "counter") add("counter", "Counter-offer in an ongoing negotiation.");
  if (mentionsPricing(lead.message)) {
    add("pricing", "The lead asks about pricing. Replies never quote prices, so check the wording.");
  }
  if (/Checks failed:/.test(rationale)) add("guardrail", "A guardrail check failed (see the notes below).");
  else if (/template/i.test(rationale)) add("template", "Written from a template because no AI model was available.");
  else if (message.kind === "reply" && confidence < AUTO_REPLY_MIN_CONFIDENCE) {
    add("low_confidence", `Low drafting confidence (${Math.round(confidence * 100)}%).`);
  }
  if (message.kind === "reply" && lead.fit && lead.fit !== "high") {
    add("fit", `${lead.fit[0].toUpperCase()}${lead.fit.slice(1)} fit: only high-fit leads can auto-send.`);
  }
  if (org.plan === "free") add("plan", "Free plan: every reply waits for your approval.");
  else if (org.autonomy === "manual") add("autonomy", "Auto-reply is off in Settings.");

  const couldAutoSendOnPro =
    message.kind === "reply" &&
    lead.fit === "high" &&
    (lead.score ?? 0) >= AUTO_REPLY_MIN_SCORE &&
    (lead.scoreConfidence ?? 1) >= AUTO_REPLY_MIN_CONFIDENCE &&
    confidence >= AUTO_REPLY_MIN_CONFIDENCE &&
    !/Checks failed:|template/i.test(rationale);

  return { reasons, couldAutoSendOnPro };
}
