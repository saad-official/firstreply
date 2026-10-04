import "server-only";
import * as formsRepo from "@/lib/db/repositories/forms";
import * as webhookTokensRepo from "@/lib/db/repositories/webhookTokens";
import type { Form, WebhookToken } from "@/lib/db/types";
import { detectProvider, normalizeWebhookPayload, type WebhookProvider } from "@/lib/domain/adapters";
import { NotFoundError, ServiceError } from "./errors";
import { ingestLead, type IngestResult } from "./intake";
import { nowFrom, type ServiceDeps } from "./shared";

/**
 * Lead capture endpoints (spec 3.1): provider webhooks authenticated by a
 * secret path token, and the hosted form.
 *
 * Rate limiting is in-memory, per server instance: a sliding one-minute
 * window per webhook token (30 requests) and per form + client IP (10). On
 * serverless it is best-effort (each warm instance counts separately), which
 * is enough to blunt a runaway integration or a form-spamming bot; the hard
 * cap is the plan's monthly lead limit, enforced in the database. Chosen over
 * an in-DB counter to keep a write off every request on the hot path.
 */

const WINDOW_MS = 60_000;
export const TOKEN_LIMIT_PER_MINUTE = 30;
export const FORM_LIMIT_PER_MINUTE = 10;
const MAX_KEYS = 10_000;

const hits = new Map<string, number[]>();

/** Records a hit and throws ServiceError("rate_limited") when the key is over `limit` in the last minute. */
export function checkRateLimit(key: string, limit: number, now: Date = new Date()): void {
  const t = now.getTime();
  const recent = (hits.get(key) ?? []).filter((h) => t - h < WINDOW_MS);
  if (recent.length >= limit) {
    hits.set(key, recent);
    throw new ServiceError("rate_limited", "Too many requests. Try again in a minute.");
  }
  recent.push(t);
  hits.set(key, recent);
  if (hits.size > MAX_KEYS) {
    for (const [k, v] of hits) {
      if (v.every((h) => t - h >= WINDOW_MS)) hits.delete(k);
    }
  }
}

/** Tests: forget every counter. */
export function resetRateLimits(): void {
  hits.clear();
}

const PROVIDER_LABEL: Record<WebhookProvider, string> = {
  typeform: "Typeform",
  tally: "Tally",
  webflow: "Webflow",
  framer: "Framer",
  form: "Hosted form",
  webhook: "Webhook",
};

/** The active token or ServiceError("unauthorized"). Stamps last_used_at. */
export async function verifyToken(token: string, now: Date = new Date()): Promise<WebhookToken> {
  const row = token ? await webhookTokensRepo.getByToken(token, { now }) : null;
  if (!row) throw new ServiceError("unauthorized", "Unknown or revoked webhook token.");
  return row;
}

export type WebhookIntake = IngestResult & { provider: WebhookProvider };

/** POST /api/leads/webhook/<token>: verify, rate-limit, normalise the provider payload, ingest. */
export async function ingestWebhook(
  token: string,
  body: unknown,
  headers: Record<string, string>,
  deps?: ServiceDeps,
): Promise<WebhookIntake> {
  const now = nowFrom(deps);
  const row = await verifyToken(token, now);
  checkRateLimit(`token:${row.id}`, TOKEN_LIMIT_PER_MINUTE, now);
  const lowered = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  const provider = detectProvider(
    typeof body === "string" ? safeJson(body) ?? body : body,
    lowered,
  );
  const input = normalizeWebhookPayload(body, lowered);
  if (!input) throw new ServiceError("invalid_input", "No lead email address was found in the payload.");
  const label = row.sourceLabel && row.sourceLabel !== "Webhook" ? row.sourceLabel : PROVIDER_LABEL[provider];
  const result = await ingestLead(
    row.orgId,
    input,
    { sourceLabel: label, tokenId: row.id, actor: "webhook" },
    deps,
  );
  return { ...result, provider };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export type HostedFormIntake = IngestResult & { form: Form };

/** POST /api/leads from the hosted form /f/<slug> (field names are ours; honeypot checked). */
export async function ingestHostedForm(
  formSlug: string,
  body: unknown,
  headers: Record<string, string>,
  meta: { ip?: string | null } = {},
  deps?: ServiceDeps,
): Promise<HostedFormIntake> {
  const form = formSlug ? await formsRepo.getBySlug(formSlug) : null;
  if (!form) throw new NotFoundError("Form");
  const now = nowFrom(deps);
  checkRateLimit(`form:${form.id}:${meta.ip ?? "unknown"}`, FORM_LIMIT_PER_MINUTE, now);
  const lowered = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  const input = normalizeWebhookPayload(body, { ...lowered, "x-firstreply-form": form.slug }, {
    honeypotField: form.honeypotField,
  });
  if (!input) throw new ServiceError("invalid_input", "Enter a valid email address so we can reply.");
  const result = await ingestLead(
    form.orgId,
    { ...input, source: "form" },
    { sourceLabel: form.name, formId: form.id, ip: meta.ip, actor: "webhook" },
    deps,
  );
  return { ...result, form };
}
