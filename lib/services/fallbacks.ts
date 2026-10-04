import "server-only";
import type { CallMeta } from "@/lib/ai/generate";
import type { ClassifyInput, ClassifyResult } from "@/lib/ai/prompts/classify";
import type { DeclineInput, DraftResult, ReplyInput } from "@/lib/ai/prompts/reply";
import type { ScoreInput, ScoreResult } from "@/lib/ai/prompts/score";
import type { SimulateInput, SimulateResult } from "@/lib/ai/prompts/simulate-lead-reply";
import { addDaysToIsoDate, isoDateInZone, isoWeekday } from "@/lib/domain/dates";
import { firstNameOf, validateDeclineDraft, validateReplyDraft } from "@/lib/domain/guardrails";
import { stripQuotedReply } from "@/lib/domain/negotiation";
import { adjustScore, fitFromScore, wordCount } from "@/lib/domain/scoring";
import type { ReplyClassification, ReplyDraft, ScoreOutput } from "@/lib/domain/types";

/**
 * Deterministic stand-ins for the four prompts, used when no model is
 * configured or the provider call fails (rate limit, outage). They keep the
 * pipeline moving (a lead still gets a draft within the minute) but never
 * act alone: every fallback reports low confidence, so nothing it writes can
 * auto-send, and the queue says the text came from a template.
 *
 * Spec is silent on model outages; this is the series' "degrade, don't drop"
 * rule.
 */

export const FALLBACK_MODEL = "fallback";
export const FALLBACK_PROMPT_VERSION = "fallback/v1";
/** Template drafts never reach the auto-send threshold (0.8). */
export const FALLBACK_DRAFT_CONFIDENCE = 0.5;

function meta(): CallMeta {
  return { model: FALLBACK_MODEL, promptVersion: FALLBACK_PROMPT_VERSION, tokensIn: 0, tokensOut: 0, latencyMs: 0, attempts: 0 };
}

export function isFallbackMeta(m: CallMeta | undefined): boolean {
  return m?.model === FALLBACK_MODEL;
}

/* ------------------------------------------------------------------ */
/* Scoring                                                             */
/* ------------------------------------------------------------------ */

const SPAM_SIGNALS =
  /\b(?:seo|backlinks?|link[- ]building|guest posts?|rank(?:ing)? #?1|first page of google|crypto|bitcoin|casino|dear sir|dear madam|lead lists?|email lists?|outsourc\w*|whitelabel|white-label)\b/i;
const LOW_SIGNALS =
  /\b(?:for free|free of charge|no budget|unpaid|student|internship|school project|volunteer|job application|hiring me|my cv|portfolio review)\b/i;

export function fallbackScore(input: ScoreInput): ScoreResult {
  const message = input.lead.message ?? "";
  const words = wordCount(message);
  const reasons: string[] = [];
  let score: number;
  if (SPAM_SIGNALS.test(message)) {
    score = 5;
    reasons.push("Reads like a sales or SEO pitch, not an enquiry");
  } else if (LOW_SIGNALS.test(message)) {
    score = 25;
    reasons.push("Asks for unpaid or out-of-scope work");
  } else {
    score = 50;
    reasons.push("Genuine enquiry about our services");
    const e = input.enrichment;
    if (e && (e.title || e.excerpt)) {
      score += 15;
      reasons.push("Company website found");
    }
    if (words >= 25) {
      score += 10;
      reasons.push("Detailed brief");
    }
    if (input.lead.company) {
      score += 5;
      reasons.push("Company named");
    }
  }
  const who = [input.lead.name ?? "A lead", input.lead.company ? `from ${input.lead.company}` : ""].filter(Boolean).join(" ");
  const output: ScoreOutput = {
    score: Math.min(100, score),
    fit: fitFromScore(Math.min(100, score)),
    reasons,
    summary: `${who} sent a ${words}-word enquiry (scored by keyword rules: no AI model was available).`,
    confidence: 0.3,
  };
  return { output, adjusted: adjustScore(output, input.lead), meta: meta() };
}

/* ------------------------------------------------------------------ */
/* Drafting                                                            */
/* ------------------------------------------------------------------ */

function greeting(name: string | undefined): string {
  const first = firstNameOf(name);
  return first ? `Hi ${first},` : "Hi there,";
}

function sentenceCase(text: string): string {
  const t = text.trim().replace(/\.$/, "");
  return t ? t.charAt(0).toLowerCase() + t.slice(1) : t;
}

export function fallbackReply(input: ReplyInput): DraftResult {
  const counter = input.kind === "counter";
  const about = input.lead.company ? ` about your work at ${input.lead.company}` : "";
  const body = [
    greeting(input.lead.name),
    "",
    counter
      ? "Thanks for coming back to me so quickly. Unfortunately that time is no longer free on our side, so here are some alternatives that are open right now:"
      : `Thanks for getting in touch with ${input.businessName}${about}. I have read your message and would like to learn more, so the easiest next step is ${sentenceCase(input.offer)}.\n\nHere are three times that work on our side:`,
    ...input.slots.map((s) => `- ${s}`),
    "",
    `If none of these suit you, you can pick any open time here: ${input.bookingUrl}`,
    "",
    counter ? "Sorry for the back and forth, and looking forward to speaking with you." : "Looking forward to speaking with you.",
    "",
    "Best,",
    input.signature,
  ].join("\n");
  const subject = counter
    ? "New times for our call"
    : input.lead.company
      ? `Your enquiry to ${input.businessName}: a quick call?`
      : `Thanks for getting in touch with ${input.businessName}`;
  const draft: ReplyDraft = {
    subject: subject.slice(0, 70),
    body,
    confidence: FALLBACK_DRAFT_CONFIDENCE,
    rationale: "Written from a template because no AI model was available.",
  };
  const validation = validateReplyDraft(draft, {
    slots: input.slots,
    bookingUrl: input.bookingUrl,
    firstName: firstNameOf(input.lead.name),
    signature: input.signature,
    offer: input.offer,
  });
  return { draft: { ...draft, confidence: validation.adjustedConfidence }, validation, meta: meta() };
}

export function fallbackDecline(input: DeclineInput): DraftResult {
  const body = [
    greeting(input.lead.name),
    "",
    `Thank you for reaching out to ${input.businessName}. Having read your message, this is outside what we focus on at the moment, and I would rather tell you now than keep you waiting.`,
    "",
    input.resourceUrl
      ? `You might find this useful as a next step: ${input.resourceUrl}`
      : "A specialist closer to what you need will serve you better, and I hope you find the right fit quickly.",
    "",
    "Wishing you all the best with it.",
    "",
    "Best,",
    input.signature,
  ].join("\n");
  const draft: ReplyDraft = {
    subject: `Thanks for contacting ${input.businessName}`.slice(0, 70),
    body,
    confidence: FALLBACK_DRAFT_CONFIDENCE,
    rationale: "Written from a template because no AI model was available.",
  };
  const validation = validateDeclineDraft(draft, { signature: input.signature, offer: input.offer });
  return { draft: { ...draft, confidence: validation.adjustedConfidence }, validation, meta: meta() };
}

/* ------------------------------------------------------------------ */
/* Classification                                                      */
/* ------------------------------------------------------------------ */

const OOO = /\b(?:out of (?:the )?office|away until|on (?:annual )?leave|on holiday|on vacation|automatic reply|auto-?reply|limited access to email)\b/i;
const NOT_INTERESTED =
  /\b(?:not interested|no longer (?:interested|need)|(?:went|gone|go|going) with (?:another|a different|someone)|chosen (?:another|someone)|decided against|please (?:stop|remove)|unsubscribe)\b/i;
const ISO_DATE = /\b(\d{4}-\d{2}-\d{2})\b/;
const ISO_DATETIME = /\b(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2})\b/;
const WEEKDAY_NAMES: Record<string, number> = {
  mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5, sat: 6, saturday: 6, sun: 7, sunday: 7,
};

function normalize(text: string): string {
  return text.replace(/[‐-―−]/g, "-").replace(/\s+/g, " ").trim().toLowerCase();
}

function classification(
  intent: ReplyClassification["intent"],
  confidence: number,
  summary: string,
  suggestedAction: string,
  extra: Partial<ReplyClassification> = {},
): ReplyClassification {
  return {
    intent,
    acceptedSlotIndex: null,
    proposedStart: null,
    proposedTimezone: null,
    returnDate: null,
    summary,
    suggestedAction,
    confidence,
    ...extra,
  };
}

/** Which offered slot the reply names: quoted verbatim, or by weekday plus start time ("Wednesday at 14:00"). */
function acceptedIndex(text: string, slots: readonly string[]): number | null {
  const t = normalize(text);
  const verbatim = slots.findIndex((s) => t.includes(normalize(s)));
  if (verbatim !== -1) return verbatim;
  const matches = slots
    .map((s, i) => {
      const day = s.slice(0, 3).toLowerCase();
      const start = /(\d{2}):(\d{2})/.exec(s);
      if (!start) return -1;
      const hour = Number(start[1]);
      const times = [`${start[1]}:${start[2]}`, `${hour}:${start[2]}`];
      if (start[2] === "00") times.push(`${hour % 12 || 12}${hour < 12 ? "am" : "pm"}`, `${hour % 12 || 12} ${hour < 12 ? "am" : "pm"}`);
      const namesDay = Object.entries(WEEKDAY_NAMES).some(
        ([name, n]) => n === WEEKDAY_NAMES[day] && new RegExp(`\\b${name}\\b`).test(t),
      );
      return namesDay && times.some((x) => t.includes(x)) ? i : -1;
    })
    .filter((i) => i !== -1);
  return matches.length === 1 ? matches[0] : null;
}

export function fallbackClassify(input: ClassifyInput): ClassifyResult {
  const text = stripQuotedReply(input.replyText);
  let result: ReplyClassification;
  if (OOO.test(text)) {
    const date = ISO_DATE.exec(text)?.[1] ?? null;
    result = classification("out_of_office", 0.75, "Automatic out-of-office reply.", "Follow up when they are back.", {
      returnDate: date,
    });
  } else if (NOT_INTERESTED.test(text)) {
    result = classification("not_interested", 0.7, "The lead is no longer interested.", "Close the lead.");
  } else if (acceptedIndex(text, input.offeredSlots) !== null) {
    const index = acceptedIndex(text, input.offeredSlots);
    result = classification("accepts_slot", 0.8, `The lead accepted slot [${index}].`, "Book the meeting.", {
      acceptedSlotIndex: index,
    });
  } else if (ISO_DATETIME.test(text)) {
    const m = ISO_DATETIME.exec(text)!;
    const proposed = `${m[1]}T${m[2].padStart(2, "0")}:${m[3]}`;
    result = classification("proposes_time", 0.7, `The lead proposed ${proposed}.`, "Book it if free, else counter.", {
      proposedStart: proposed,
      proposedTimezone: input.timezone,
    });
  } else if (text.includes("?")) {
    result = classification("asks_question", 0.65, "The lead asked a question before booking.", "Answer the question.");
  } else {
    result = classification("other", 0.3, "The reply could not be classified without an AI model.", "Read the reply and respond.");
  }
  return { classification: result, meta: meta() };
}

/* ------------------------------------------------------------------ */
/* Demo: simulated lead replies                                        */
/* ------------------------------------------------------------------ */

/** A weekday date `days` or more ahead in `zone`, "YYYY-MM-DD". */
function weekdayAhead(now: Date, zone: string, days: number): string {
  let date = addDaysToIsoDate(isoDateInZone(now, zone), days);
  while (isoWeekday(date) > 5) date = addDaysToIsoDate(date, 1);
  return date;
}

export function fallbackSimulate(input: SimulateInput): SimulateResult {
  const zone = input.leadTimezone ?? "UTC";
  const first = firstNameOf(input.leadName) ?? "Alex";
  const company = input.company ? input.company.toLowerCase().replace(/[^a-z0-9]+/g, "") : "company";
  const pick = input.offeredSlots[1] ?? input.offeredSlots[0];
  const bodies: Record<SimulateInput["intent"], string> = {
    accepts_slot: pick
      ? `Hi,\n\nThanks for the quick reply. ${pick} works well for me, see you then.\n\n${first}`
      : `Hi,\n\nThanks for the quick reply. Any of those times work for me.\n\n${first}`,
    proposes_time: `Hi,\n\nNone of those work for me, unfortunately. Could we do ${weekdayAhead(input.now, zone, 3)} 15:00 instead?\n\n${first}`,
    asks_question: `Hi,\n\nBefore we book anything: who would join the call from your side, and how soon could you start?\n\n${first}`,
    not_interested: `Hi,\n\nThanks for getting back to me so quickly. We have decided to go with another studio for this project, so I am not interested for now.\n\n${first}`,
    out_of_office: `Automatic reply: I am out of the office until ${weekdayAhead(input.now, zone, 5)} with limited access to email. For anything urgent, please write to team@${company}.example.`,
    other: `Hi,\n\nI am forwarding this to my colleague who looks after scheduling; they will be in touch with you directly.\n\n${first}`,
  };
  return {
    reply: { subject: `Re: ${input.ourSubject}`.slice(0, 120), body: bodies[input.intent] },
    meta: meta(),
  };
}
