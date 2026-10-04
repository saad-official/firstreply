/**
 * Webhook body -> LeadInput (spec 3.1: "Typeform/Tally/Webflow/Framer shapes
 * mapped by a small adapter table"). Pure: the route handler passes the parsed
 * body (object, URLSearchParams, or raw string) and the request headers.
 *
 * Provider shapes are taken from their public docs as remembered in Oct 2026
 * (see tests/domain/fixtures/webhooks.ts); unknown shapes fall through to the
 * flat-object heuristics, so a provider tweak degrades gracefully instead of
 * dropping the lead.
 */
import { isValidTimeZone, LeadInputSchema, type LeadInput, type LeadSource } from "./types";

export type WebhookProvider = Extract<LeadSource, "typeform" | "tally" | "webflow" | "framer" | "form" | "webhook">;

export interface NormalizeOptions {
  /** Hosted form honeypot field name (forms.honeypot_field). */
  honeypotField?: string;
}

const MAX_MESSAGE_CHARS = 10_000;
const MAX_SHORT_CHARS = 200;
const MAX_CUSTOM_FIELDS = 50;
const MAX_CUSTOM_KEY_CHARS = 100;
const MAX_CUSTOM_VALUE_CHARS = 2_000;
const MAX_NAME_WORDS = 6;
const MAX_COMPANY_WORDS = 8;
const MIN_FALLBACK_MESSAGE_WORDS = 3;

const EMAIL_LIKE = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[a-z]{2,}$/i;

/** Keys that carry form plumbing, not lead data. */
const IGNORED_KEYS = new Set([
  "formslug",
  "form slug",
  "form",
  "form name",
  "form id",
  "g recaptcha response",
  "cf turnstile response",
  "h captcha response",
  "submit",
]);

const VOCAB = {
  email: /\be ?mail\b/,
  company: /\b(?:company|organi[sz]ation|org|business|firm|employer|agency)\b/,
  firstName: /\b(?:first ?name|given name|forename)\b/,
  lastName: /\b(?:last ?name|surname|family name)\b/,
  name: /\b(?:full ?name|your name|name)\b/,
  message: /\b(?:message|msg|comments?|details|enquiry|inquiry|help|tell us|describe|description|notes?|project|question|requirements?|brief|need)\b/,
  timezone: /\b(?:time ?zone|tz)\b/,
} as const;

type Json = Record<string, unknown>;

interface Entry {
  /** Human label kept for customFields. */
  label: string;
  /** Normalised text the vocabulary is matched against. */
  match: string;
  value: string;
}

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof URLSearchParams);
}

function lowerKeys(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
}

/** "firstName" / "first_name" / "First-Name?" -> "first name". */
export function normalizeKey(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .toLowerCase();
}

function stringify(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(stringify).filter(Boolean).join(", ");
  return "";
}

const words = (text: string) => text.split(/\s+/).filter(Boolean).length;
const clip = (text: string, max: number) => (text.length > max ? text.slice(0, max).trim() : text);

function entriesFromObject(obj: Json): Entry[] {
  return Object.entries(obj).map(([label, raw]) => ({ label, match: normalizeKey(label), value: stringify(raw) }));
}

/* ------------------------------------------------------------------ */
/* Provider detection                                                  */
/* ------------------------------------------------------------------ */

export function detectProvider(body: unknown, headers: Record<string, string>): WebhookProvider {
  const h = lowerKeys(headers);
  if (isRecord(body)) {
    const fr = body.form_response;
    if (isRecord(fr) && Array.isArray(fr.answers)) return "typeform";
    if (isRecord(body.data) && Array.isArray(body.data.fields)) return "tally";
    if (body.triggerType === "form_submission" || (isRecord(body.payload) && isRecord(body.payload.data))) {
      return "webflow";
    }
    if (typeof body.site === "string" && isRecord(body.data) && "_id" in body) return "webflow";
  }
  if (Object.keys(h).some((k) => k.startsWith("framer-"))) return "framer";
  if (h["x-firstreply-form"] || (isRecord(body) && typeof body.formSlug === "string")) return "form";
  return "webhook";
}

/* ------------------------------------------------------------------ */
/* Provider extractors -> entries                                      */
/* ------------------------------------------------------------------ */

function typeformEntries(body: Json): Entry[] {
  const fr = body.form_response as Json;
  const definition = isRecord(fr.definition) && Array.isArray(fr.definition.fields) ? fr.definition.fields : [];
  const titles = new Map<string, string>();
  for (const f of definition) {
    if (isRecord(f) && typeof f.id === "string" && typeof f.title === "string") titles.set(f.id, f.title);
  }
  const entries: Entry[] = [];
  for (const answer of fr.answers as unknown[]) {
    if (!isRecord(answer) || !isRecord(answer.field)) continue;
    const id = typeof answer.field.id === "string" ? answer.field.id : "";
    const ref = typeof answer.field.ref === "string" ? answer.field.ref : "";
    const title = titles.get(id) ?? "";
    entries.push({
      label: title || ref || id,
      match: normalizeKey(`${title} ${ref}`),
      value: typeformValue(answer),
    });
  }
  if (isRecord(fr.hidden)) entries.push(...entriesFromObject(fr.hidden));
  return entries;
}

function typeformValue(answer: Json): string {
  const type = typeof answer.type === "string" ? answer.type : "";
  const raw = answer[type];
  if (type === "choice" && isRecord(raw)) return stringify(raw.label ?? raw.other);
  if (type === "choices" && isRecord(raw)) return stringify([...(Array.isArray(raw.labels) ? raw.labels : []), raw.other]);
  return stringify(raw);
}

function tallyEntries(body: Json): Entry[] {
  const fields = (body.data as Json).fields as unknown[];
  const entries: Entry[] = [];
  for (const field of fields) {
    if (!isRecord(field)) continue;
    const label = typeof field.label === "string" ? field.label : typeof field.key === "string" ? field.key : "";
    let value = field.value;
    if (Array.isArray(value) && Array.isArray(field.options)) {
      const options = new Map<unknown, unknown>(
        field.options.filter(isRecord).map((o) => [o.id, o.text] as [unknown, unknown]),
      );
      value = value.map((v) => options.get(v) ?? v);
    }
    entries.push({ label, match: normalizeKey(label), value: stringify(value) });
  }
  return entries;
}

function webflowEntries(body: Json): Entry[] {
  const data = isRecord(body.payload) && isRecord(body.payload.data) ? body.payload.data : body.data;
  return isRecord(data) ? entriesFromObject(data) : [];
}

function framerEntries(body: Json): Entry[] {
  return entriesFromObject(isRecord(body.data) ? body.data : body);
}

/* ------------------------------------------------------------------ */
/* Heuristic mapping                                                   */
/* ------------------------------------------------------------------ */

interface Mapped {
  name?: string;
  email?: string;
  company?: string;
  message?: string;
  leadTimezone?: string;
  honeypotFilled?: boolean;
  customFields: Record<string, string>;
}

function mapEntries(all: Entry[], options: NormalizeOptions): Mapped {
  const honeypot = options.honeypotField ? normalizeKey(options.honeypotField) : null;
  const out: Mapped = { customFields: {} };
  if (honeypot) out.honeypotFilled = all.some((e) => e.match === honeypot && e.value.length > 0);

  const entries = all.filter(
    (e) =>
      e.value.length > 0 &&
      !e.label.startsWith("_") &&
      !IGNORED_KEYS.has(e.match) &&
      (honeypot === null || e.match !== honeypot),
  );
  const used = new Set<Entry>();
  const take = (predicate: (e: Entry) => boolean): Entry | undefined => {
    const found = entries.find((e) => !used.has(e) && predicate(e));
    if (found) used.add(found);
    return found;
  };

  const email =
    take((e) => VOCAB.email.test(e.match) && EMAIL_LIKE.test(e.value)) ?? take((e) => EMAIL_LIKE.test(e.value));
  out.email = email?.value;

  const short = (e: Entry, maxWords: number) => words(e.value) <= maxWords && e.value.length <= MAX_SHORT_CHARS;
  out.company = take((e) => VOCAB.company.test(e.match) && short(e, MAX_COMPANY_WORDS))?.value;

  const first = take((e) => VOCAB.firstName.test(e.match) && short(e, MAX_NAME_WORDS));
  const last = take((e) => VOCAB.lastName.test(e.match) && short(e, MAX_NAME_WORDS));
  const full = first || last ? undefined : take((e) => VOCAB.name.test(e.match) && short(e, MAX_NAME_WORDS));
  const name = full?.value ?? [first?.value, last?.value].filter(Boolean).join(" ");
  if (name) out.name = name;

  const tz = take((e) => VOCAB.timezone.test(e.match));
  if (tz && isValidTimeZone(tz.value)) out.leadTimezone = tz.value;

  const message =
    take((e) => VOCAB.message.test(e.match)) ??
    entries
      .filter((e) => !used.has(e) && words(e.value) >= MIN_FALLBACK_MESSAGE_WORDS)
      .reduce<Entry | undefined>((best, e) => (!best || e.value.length > best.value.length ? e : best), undefined);
  if (message) {
    used.add(message);
    out.message = message.value;
  }

  for (const e of entries) {
    if (used.has(e) || Object.keys(out.customFields).length >= MAX_CUSTOM_FIELDS) continue;
    out.customFields[clip(e.label, MAX_CUSTOM_KEY_CHARS)] = clip(e.value, MAX_CUSTOM_VALUE_CHARS);
  }
  return out;
}

/** Our hosted form posts known field names; no guessing needed. */
function mapHostedForm(body: Json, options: NormalizeOptions): Mapped {
  const custom = isRecord(body.customFields) ? body.customFields : isRecord(body.custom) ? body.custom : {};
  const customFields: Record<string, string> = {};
  for (const [k, v] of Object.entries(custom).slice(0, MAX_CUSTOM_FIELDS)) {
    const value = stringify(v);
    if (value) customFields[clip(k, MAX_CUSTOM_KEY_CHARS)] = clip(value, MAX_CUSTOM_VALUE_CHARS);
  }
  const tz = stringify(body.leadTimezone ?? body.timezone);
  const mapped: Mapped = {
    name: stringify(body.name) || undefined,
    email: stringify(body.email) || undefined,
    company: stringify(body.company) || undefined,
    message: stringify(body.message),
    leadTimezone: tz && isValidTimeZone(tz) ? tz : undefined,
    customFields,
  };
  if (options.honeypotField) mapped.honeypotFilled = stringify(body[options.honeypotField]).length > 0;
  return mapped;
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

function coerceBody(body: unknown, headers: Record<string, string>): Json | null {
  if (body instanceof URLSearchParams) return Object.fromEntries(body.entries());
  if (typeof body === "string") {
    const text = body.trim();
    if (!text) return null;
    const contentType = headers["content-type"] ?? "";
    if (contentType.includes("json") || text.startsWith("{")) {
      try {
        const parsed: unknown = JSON.parse(text);
        return isRecord(parsed) ? parsed : null;
      } catch {
        return null;
      }
    }
    return Object.fromEntries(new URLSearchParams(text).entries());
  }
  return isRecord(body) ? body : null;
}

export function normalizeWebhookPayload(
  body: unknown,
  headers: Record<string, string>,
  options: NormalizeOptions = {},
): LeadInput | null {
  const h = lowerKeys(headers);
  const obj = coerceBody(body, h);
  if (!obj) return null;

  const provider = detectProvider(obj, h);
  let mapped: Mapped;
  switch (provider) {
    case "typeform":
      mapped = mapEntries(typeformEntries(obj), options);
      break;
    case "tally":
      mapped = mapEntries(tallyEntries(obj), options);
      break;
    case "webflow":
      mapped = mapEntries(webflowEntries(obj), options);
      break;
    case "framer":
      mapped = mapEntries(framerEntries(obj), options);
      break;
    case "form":
      mapped = mapHostedForm(obj, options);
      break;
    case "webhook":
      mapped = mapEntries(entriesFromObject(obj), options);
      break;
  }
  if (!mapped.email) return null;

  const candidate: Record<string, unknown> = {
    source: provider,
    email: mapped.email,
    message: clip(mapped.message ?? "", MAX_MESSAGE_CHARS),
  };
  if (mapped.name) candidate.name = clip(mapped.name, MAX_SHORT_CHARS);
  if (mapped.company) candidate.company = clip(mapped.company, MAX_SHORT_CHARS);
  if (Object.keys(mapped.customFields).length > 0) candidate.customFields = mapped.customFields;
  if (mapped.leadTimezone) candidate.leadTimezone = mapped.leadTimezone;
  if (mapped.honeypotFilled !== undefined) candidate.honeypotFilled = mapped.honeypotFilled;

  const parsed = LeadInputSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}
