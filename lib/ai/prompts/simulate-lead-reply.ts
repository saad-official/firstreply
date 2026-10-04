import "server-only";
import { z } from "zod";
import { generateStructured, type CallMeta } from "@/lib/ai/generate";
import { formatInstantFor } from "@/lib/domain/slots";
import type { ReplyIntent } from "@/lib/domain/types";

/**
 * Demo only (spec 3.7 "Simulate reply"): writes a plausible reply from the
 * lead with an intent the owner picks, so the negotiation flow can be shown
 * without a real inbox. Messages it produces are stored with simulated = true.
 */
export const SIMULATE_PROMPT_VERSION = "simulate-lead-reply/v1";

export const SimulatedReplySchema = z.object({
  subject: z.string().min(1),
  body: z.string().min(1),
});
export type SimulatedReply = z.infer<typeof SimulatedReplySchema>;

export interface SimulateInput {
  intent: ReplyIntent;
  leadName?: string;
  company?: string;
  ourSubject: string;
  ourBody: string;
  offeredSlots: string[];
  leadTimezone?: string;
  now: Date;
}

export interface SimulateResult {
  reply: SimulatedReply;
  meta: CallMeta;
}

const INTENT_GUIDE: Record<ReplyIntent, string> = {
  accepts_slot: "Accept exactly one of the offered slots. Refer to it naturally (e.g. \"Wednesday at 2 works\" or quote it).",
  proposes_time:
    "None of the slots work. Propose one specific alternative day and time in your own time zone, using a relative phrase such as \"Thursday at 3pm\" or \"next Monday morning, 10am\".",
  asks_question:
    "Do not pick a time yet. Ask one or two concrete questions first (for example about process, timeline or who will join the call).",
  not_interested: "Politely say you are no longer interested, with a short reason (went with another provider, project paused).",
  out_of_office:
    "Write an automatic out-of-office reply: away until a specific date 2-10 days from now, with a colleague's address for urgent matters.",
  other: "Write something that fits none of the other categories, e.g. forwarding the thread to a colleague who will handle it.",
};

export const SIMULATE_INSTRUCTIONS = `You play a prospective customer replying to a business's email in a product demo.
Rules:
- Write like a real, busy person: 1-5 short sentences, plain text, no markdown, sign with your first name (except for automatic replies).
- Follow the requested intent exactly. Do not include the quoted original email.
- Use only fictional details. Never include real phone numbers, addresses or links.
- subject: "Re: " followed by the original subject.`;

export function buildSimulatePrompt(input: SimulateInput): string {
  const zone = input.leadTimezone ?? "UTC";
  return [
    `Requested intent: ${input.intent}. ${INTENT_GUIDE[input.intent]}`,
    "",
    `You are ${input.leadName ?? "the lead"}${input.company ? ` from ${input.company}` : ""}. Your time zone: ${zone}.`,
    `It is now ${formatInstantFor(input.now, zone)}.`,
    "",
    `The email you received (subject "${input.ourSubject}"):`,
    input.ourBody.trim(),
    "",
    input.offeredSlots.length > 0 ? `Slots it offered:\n${input.offeredSlots.map((s) => `- ${s}`).join("\n")}` : "",
  ]
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function simulateLeadReply(input: SimulateInput): Promise<SimulateResult> {
  const { object, meta } = await generateStructured({
    name: "lead_reply_simulator",
    promptVersion: SIMULATE_PROMPT_VERSION,
    schema: SimulatedReplySchema,
    instructions: SIMULATE_INSTRUCTIONS,
    prompt: buildSimulatePrompt(input),
    temperature: 0.8,
  });
  return { reply: object, meta };
}
