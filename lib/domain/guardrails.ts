/**
 * Guardrails applied to every model-written email before it is stored
 * (spec 3.4). The slot engine decides the times and the owner decides the
 * offer; these checks stop the model from dropping slots or the booking link,
 * leaving placeholders, or promising prices. Any violation forces the draft's
 * confidence to 0 so it can never auto-send.
 *
 * Not checked deterministically (prompt-only): "no claims about the company
 * beyond the enrichment summary".
 */
import { wordCount } from "./scoring";
import type { ReplyDraft } from "./types";

export const REPLY_MIN_WORDS = 60;
export const REPLY_MAX_WORDS = 180;
export const DECLINE_MAX_WORDS = 120;

export interface ReplyDraftContext {
  /** Slot strings exactly as rendered by formatSlotFor; each must appear in the body. */
  slots: readonly string[];
  bookingUrl: string;
  firstName?: string;
  signature?: string;
  /** Owner's offer text; pricing terms that appear here are allowed in the draft. */
  offer: string;
}

export interface DeclineDraftContext {
  /** Slots that must NOT appear in a decline. */
  slots?: readonly string[];
  bookingUrl?: string;
  signature?: string;
  offer?: string;
}

export type ViolationCode =
  | "missing_slot"
  | "missing_booking_url"
  | "missing_first_name"
  | "placeholder"
  | "pricing"
  | "word_count"
  | "missing_sign_off"
  | "offers_meeting"
  | "unkind";

export interface Violation {
  code: ViolationCode;
  message: string;
}

export interface DraftValidation {
  ok: boolean;
  violations: Violation[];
  /** Draft confidence clamped to [0, 1], or 0 when any violation exists (forces approval). */
  adjustedConfidence: number;
}

const PLACEHOLDER_PATTERNS: RegExp[] = [
  /\{\{[^}]*\}\}/, // {{first_name}}
  /\{[A-Za-z_][\w ]*\}/, // {company}
  /\[[A-Z][A-Za-z]*(?:[ _][A-Za-z]+)*\](?!\()/, // [First Name], not a markdown link
  /<<[^>]*>>/, // <<NAME>>
  /\b(?:TBD|TODO|XXX+)\b/,
];

/** Pricing promises. A pattern that matches the owner's offer text is allowed. */
export const PRICING_PATTERNS: ReadonlyArray<{ label: string; pattern: RegExp }> = [
  { label: "currency symbol", pattern: /[$£€]/ },
  { label: "currency amount", pattern: /\b\d[\d,.]*\s?(?:k\s)?(?:usd|gbp|eur|dollars?|pounds?|euros?)\b/i },
  { label: "price", pattern: /\bpric(?:e|es|ed|ing)\b/i },
  { label: "quote", pattern: /\bquot(?:e|es|ed|ation|ations)\b/i },
  { label: "discount", pattern: /\bdiscount\w*\b/i },
  { label: "percent off", pattern: /\b\d+\s?%\s?off\b/i },
  { label: "cost", pattern: /\bcost(?:s|ing)?\b/i },
  { label: "fee", pattern: /\bfees?\b/i },
  { label: "rate", pattern: /\b(?:hourly|daily|day|day's|flat) rates?\b/i },
];

const UNKIND_PATTERNS: RegExp[] = [
  /\bspam\w*\b/i,
  /\bscam\w*\b/i,
  /\bwaste of (?:our|my|your) time\b/i,
  /\bnot worth\b/i,
  /\btoo small\b/i,
  /\bunqualified\b/i,
  /\b(?:can't|cannot|can not) afford\b/i,
  /\b(?:stupid|ridiculous|pointless|junk|irrelevant)\b/i,
];

/** "14:00-14:30", "2pm", "10:30 am": anything that reads like a meeting time. */
const TIME_LIKE = /\b\d{1,2}:\d{2}\s*[-–—]\s*\d{1,2}:\d{2}\b|\b\d{1,2}(?::\d{2})?\s?(?:am|pm)\b/i;

const SIGN_OFF =
  /^(?:thanks|thank you|many thanks|with thanks|best|best regards|best wishes|all the best|kind regards|warm regards|warmly|regards|sincerely|cheers|talk soon|speak soon|wishing you)\b/i;

const SIGN_OFF_MAX_WORDS = 8;

/** Unify whitespace (incl. NBSP / narrow NBSP) and dashes, lower-case. */
function forMatch(text: string): string {
  return text
    .replace(/[‐-―−]/g, "-")
    .replace(/[\s  ]+/g, " ")
    .trim()
    .toLowerCase();
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripTrailingSlash(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

function findPlaceholder(text: string): string | null {
  for (const pattern of PLACEHOLDER_PATTERNS) {
    const m = pattern.exec(text);
    if (m) return m[0];
  }
  return null;
}

/** Remove strings the owner chose (URL, signature, slots) before scanning for banned terms. */
function scrub(text: string, remove: readonly (string | undefined)[]): string {
  return remove
    .map((r) => r?.trim())
    .filter((r): r is string => Boolean(r))
    .reduce((acc, r) => acc.replace(new RegExp(escapeRegExp(r), "gi"), " | "), text);
}

function pricingTerms(text: string, offer: string): string[] {
  return PRICING_PATTERNS.filter(({ pattern }) => pattern.test(text) && !pattern.test(offer)).map((p) => p.label);
}

function hasSignOff(body: string, signature: string | undefined): boolean {
  if (signature && signature.trim() && forMatch(body).includes(forMatch(signature))) return true;
  const lines = body
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  // A closing line is short ("Best,", "Thanks again, Sam"), not a sentence that opens with "Thank you".
  return lines.slice(-4).some((line) => SIGN_OFF.test(line) && wordCount(line) <= SIGN_OFF_MAX_WORDS);
}

function finish(violations: Violation[], confidence: number): DraftValidation {
  const clamped = Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0;
  return { ok: violations.length === 0, violations, adjustedConfidence: violations.length === 0 ? clamped : 0 };
}

export function validateReplyDraft(draft: ReplyDraft, ctx: ReplyDraftContext): DraftValidation {
  const subject = draft.subject.trim();
  const body = draft.body.trim();
  const normalizedBody = forMatch(body);
  const violations: Violation[] = [];
  const add = (code: ViolationCode, message: string) => violations.push({ code, message });

  for (const slot of ctx.slots) {
    if (!normalizedBody.includes(forMatch(slot))) add("missing_slot", `Body must include the slot "${slot}" verbatim.`);
  }

  const url = stripTrailingSlash(ctx.bookingUrl);
  if (url && !normalizedBody.includes(forMatch(url))) {
    add("missing_booking_url", `Body must include the booking link ${url}.`);
  }

  const firstName = ctx.firstName?.trim();
  if (firstName) {
    const greeting = body.split(/\r?\n/).find((l) => l.trim().length > 0) ?? "";
    const named = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(firstName)}(?![\\p{L}\\p{N}])`, "iu");
    if (!named.test(greeting)) add("missing_first_name", `Greeting must address ${firstName} by first name.`);
  }

  const placeholder = findPlaceholder(`${subject}\n${body}`);
  if (placeholder) add("placeholder", `Unreplaced placeholder "${placeholder}".`);

  const scanText = scrub(`${subject}\n${body}`, [ctx.bookingUrl, url, ctx.signature, ...ctx.slots]);
  const pricing = pricingTerms(scanText, ctx.offer);
  if (pricing.length > 0) add("pricing", `No pricing promises (found: ${pricing.join(", ")}).`);

  const words = wordCount(body);
  if (words < REPLY_MIN_WORDS || words > REPLY_MAX_WORDS) {
    add("word_count", `Body must be ${REPLY_MIN_WORDS}-${REPLY_MAX_WORDS} words (got ${words}).`);
  }

  if (!hasSignOff(body, ctx.signature)) {
    add("missing_sign_off", 'Body must end with a sign-off (e.g. "Best," or the org signature).');
  }

  return finish(violations, draft.confidence);
}

/** Declines (spec 3.4): kind, at most 120 words, no slots or booking link, no pricing. */
export function validateDeclineDraft(draft: ReplyDraft, ctx: DeclineDraftContext): DraftValidation {
  const subject = draft.subject.trim();
  const body = draft.body.trim();
  const fullText = `${subject}\n${body}`;
  const normalized = forMatch(fullText);
  const violations: Violation[] = [];
  const add = (code: ViolationCode, message: string) => violations.push({ code, message });

  const url = ctx.bookingUrl ? stripTrailingSlash(ctx.bookingUrl) : "";
  const offersSlot = (ctx.slots ?? []).some((s) => normalized.includes(forMatch(s)));
  const offersLink = url.length > 0 && normalized.includes(forMatch(url));
  if (offersSlot || offersLink || TIME_LIKE.test(scrub(fullText, [ctx.signature]))) {
    add("offers_meeting", "A decline must not offer meeting times or the booking link.");
  }

  const placeholder = findPlaceholder(fullText);
  if (placeholder) add("placeholder", `Unreplaced placeholder "${placeholder}".`);

  const scanText = scrub(fullText, [ctx.signature]);
  const pricing = pricingTerms(scanText, ctx.offer ?? "");
  if (pricing.length > 0) add("pricing", `No pricing in a decline (found: ${pricing.join(", ")}).`);

  if (UNKIND_PATTERNS.some((p) => p.test(scanText))) add("unkind", "A decline must stay kind and respectful.");

  const words = wordCount(body);
  if (words > DECLINE_MAX_WORDS) add("word_count", `Decline must be at most ${DECLINE_MAX_WORDS} words (got ${words}).`);

  if (!hasSignOff(body, ctx.signature)) {
    add("missing_sign_off", 'Body must end with a sign-off (e.g. "Best," or the org signature).');
  }

  return finish(violations, draft.confidence);
}

const HONORIFICS = new Set(["mr", "mrs", "ms", "miss", "mx", "dr", "prof", "sir"]);
const ROLE_WORDS = new Set([
  "info",
  "sales",
  "team",
  "support",
  "admin",
  "hello",
  "hi",
  "contact",
  "office",
  "marketing",
  "hr",
  "accounts",
  "enquiries",
  "inquiries",
  "billing",
  "noreply",
  "no-reply",
]);

/**
 * Best-effort first name for the greeting check: handles "Last, First",
 * honorifics, and all-caps / all-lower input. Undefined for role names
 * ("Sales Team", "info") so the guardrail does not demand "Hi Sales".
 */
export function firstNameOf(name: string | undefined | null): string | undefined {
  const trimmed = name?.trim() ?? "";
  if (!trimmed) return undefined;
  const ordered = trimmed.includes(",") ? trimmed.slice(trimmed.indexOf(",") + 1) : trimmed;
  const token = ordered
    .split(/\s+/)
    .filter(Boolean)
    .find((t) => !HONORIFICS.has(t.toLowerCase().replace(/\.$/, "")));
  if (!token || !/^\p{L}[\p{L}'’-]*\p{L}$/u.test(token) || ROLE_WORDS.has(token.toLowerCase())) return undefined;
  const uniformCase = token === token.toLowerCase() || token === token.toUpperCase();
  if (!uniformCase) return token;
  return token
    .toLowerCase()
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("-");
}
