import "server-only";
import type { ScoreInput } from "@/lib/ai/prompts/score";
import * as agentEventsRepo from "@/lib/db/repositories/agentEvents";
import * as leadsRepo from "@/lib/db/repositories/leads";
import * as messagesRepo from "@/lib/db/repositories/messages";
import * as organizationsRepo from "@/lib/db/repositories/organizations";
import type { Actor, Lead, LeadEnrichment, LeadSource as DbLeadSource, Message, Organization } from "@/lib/db/types";
import { leadKey, shouldMergeIntoExisting, DEDUPE_WINDOW_DAYS } from "@/lib/domain/dedupe";
import { decideAction, type LeadAction } from "@/lib/domain/scoring";
import { LeadInputSchema, type LeadInput, type LeadSource } from "@/lib/domain/types";
import { canAutoSend, saveDraft } from "./drafting";
import { enrichDomain } from "./enrichment";
import { NotFoundError, ServiceError } from "./errors";
import { runDecline, runReply, runScore } from "./models";
import { assertLeadAllowance, monthStartUtc } from "./plan-limits";
import { formatSlots, loadSchedule, pickSlots } from "./scheduling";
import { sendMessage } from "./sending";
import {
  audit,
  bookingUrlFor,
  leadZone,
  nowFrom,
  offerFor,
  rubricFor,
  signatureFor,
  type ServiceDeps,
} from "./shared";

/**
 * Lead intake (spec 3.1-3.4): `ingestLead` stores a lead quickly (dedupe,
 * plan limits) and returns; the caller schedules `processLead` (enrich,
 * score, decide, draft with three real slots, auto-send when allowed). The
 * daily/tick cron picks up anything a crashed request left behind.
 */

const DAY_MS = 86_400_000;

const PROVIDER_LABELS: Partial<Record<LeadSource, string>> = {
  typeform: "Typeform",
  tally: "Tally",
  webflow: "Webflow",
  framer: "Framer",
  webhook: "Webhook",
  email: "Email",
  demo: "Demo",
};

/** Domain source (provider-level) -> stored source (channel-level). */
export function storedSource(source: LeadSource): DbLeadSource {
  switch (source) {
    case "form":
      return "form";
    case "email":
      return "email";
    case "demo":
      return "demo";
    default:
      return "webhook";
  }
}

/** Stored lead -> the source enum the scoring prompt expects. */
function promptSource(lead: Lead): LeadSource {
  if (lead.source === "form" || lead.source === "email" || lead.source === "demo") return lead.source;
  const label = lead.sourceLabel?.toLowerCase() ?? "";
  for (const provider of ["typeform", "tally", "webflow", "framer"] as const) {
    if (label.includes(provider)) return provider;
  }
  return lead.source === "manual" ? "form" : "webhook";
}

/* ------------------------------------------------------------------ */
/* Dedupe                                                              */
/* ------------------------------------------------------------------ */

const GMAIL_DOMAINS = ["gmail.com", "googlemail.com"];

/**
 * The lead this email should join (spec 3.1: same person within 30 days),
 * comparing identity keys so "Jo.Doe+site@gmail.com" matches "jodoe@gmail.com".
 */
export async function findDuplicateLead(orgId: string, email: string, now: Date): Promise<Lead | null> {
  const key = leadKey(email);
  const domain = key.slice(key.lastIndexOf("@") + 1);
  const domains = GMAIL_DOMAINS.includes(domain) ? GMAIL_DOMAINS : [domain];
  const since = new Date(now.getTime() - DEDUPE_WINDOW_DAYS * DAY_MS);
  const candidates = await leadsRepo.listRecentByDomains(orgId, domains, since);
  return (
    candidates.find((c) => leadKey(c.email) === key && shouldMergeIntoExisting(c.createdAt, now)) ?? null
  );
}

/* ------------------------------------------------------------------ */
/* ingestLead                                                          */
/* ------------------------------------------------------------------ */

export type IngestMeta = {
  /** Human detail for the source, e.g. the form name or the webhook token label. */
  sourceLabel?: string | null;
  formId?: string | null;
  tokenId?: string | null;
  /** Request IP, used only for rate limiting upstream; never stored. */
  ip?: string | null;
  actor?: Actor;
};

export type IngestResult = {
  lead: Lead;
  /** A new lead row was created. */
  created: boolean;
  /** The submission joined an existing lead's thread (dedupe). */
  merged: boolean;
  /** Stored as spam without scoring (honeypot). */
  spam: boolean;
  /** The caller should schedule processLead(lead.id). */
  needsProcessing: boolean;
  /** Set when merged: the appended inbound message, to run through negotiation when the thread is live. */
  inboundMessage: Message | null;
  /** The merged message arrived on a live thread; the caller should run handleInboundReply. */
  needsNegotiation: boolean;
};

export async function ingestLead(
  orgId: string,
  raw: LeadInput,
  meta: IngestMeta = {},
  deps?: ServiceDeps,
): Promise<IngestResult> {
  const parsed = LeadInputSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ServiceError("invalid_input", parsed.error.issues[0]?.message ?? "The lead is missing an email address.");
  }
  const input = parsed.data;
  const org = await organizationsRepo.getById(orgId);
  if (!org) throw new NotFoundError("Organization");
  const now = nowFrom(deps);
  const actor = meta.actor ?? (input.source === "demo" ? "system" : "webhook");
  const honeypot = input.honeypotFilled === true;

  if (!honeypot) {
    const existing = await findDuplicateLead(orgId, input.email, now);
    if (existing) {
      const text = input.message.trim();
      const inbound = text
        ? await messagesRepo.create(orgId, {
            leadId: existing.id,
            direction: "in",
            subject: "New message from the form",
            body: text,
          })
        : null;
      await audit({
        orgId,
        actor,
        type: "lead.merged",
        entityType: "lead",
        entityId: existing.id,
        input: { source: input.source, formId: meta.formId ?? null, tokenId: meta.tokenId ?? null },
        output: { inboundMessageId: inbound?.id ?? null },
      });
      return {
        lead: existing,
        created: false,
        merged: true,
        spam: false,
        needsProcessing: false,
        inboundMessage: inbound,
        needsNegotiation: inbound !== null && (existing.status === "replied" || existing.status === "negotiating"),
      };
    }
    if (input.source !== "demo") {
      const used = await leadsRepo.countBillableCreatedSince(orgId, monthStartUtc(now));
      try {
        assertLeadAllowance(org, used);
      } catch (error) {
        await audit({
          orgId,
          actor,
          type: "lead.rejected_plan_limit",
          entityType: "organization",
          entityId: orgId,
          output: { used },
        });
        throw error;
      }
    }
  }

  const customFields = input.customFields ?? {};
  const lead = await leadsRepo.create(orgId, {
    source: storedSource(input.source),
    sourceLabel: meta.sourceLabel?.trim().slice(0, 120) || PROVIDER_LABELS[input.source] || null,
    formId: meta.formId ?? null,
    name: input.name ?? null,
    email: input.email,
    company: input.company ?? null,
    message: input.message,
    custom: customFields,
    leadTimezone: input.leadTimezone ?? null,
    status: honeypot ? "spam" : "new",
  });
  const stored = honeypot
    ? ((await leadsRepo.updateScore(orgId, lead.id, {
        score: 0,
        fit: "spam",
        reasons: ["Form honeypot field was filled: treated as spam"],
      })) ?? lead)
    : lead;
  await audit({
    orgId,
    actor,
    type: honeypot ? "lead.spam_honeypot" : "lead.received",
    entityType: "lead",
    entityId: lead.id,
    input: {
      source: input.source,
      formId: meta.formId ?? null,
      tokenId: meta.tokenId ?? null,
      customFields: Object.keys(customFields).length,
    },
  });
  return {
    lead: stored,
    created: true,
    merged: false,
    spam: honeypot,
    needsProcessing: !honeypot,
    inboundMessage: null,
    needsNegotiation: false,
  };
}

/* ------------------------------------------------------------------ */
/* processLead                                                         */
/* ------------------------------------------------------------------ */

export type ProcessResult =
  | { status: "skipped"; reason: string; lead: Lead }
  | {
      status: "processed";
      lead: Lead;
      action: LeadAction;
      messageId: string | null;
      autoSent: boolean;
      fallback: boolean;
    };

export type ProcessOptions = {
  /** Re-run on a processed lead (owner "Re-process"): rejects unsent drafts and starts over. */
  force?: boolean;
  actor?: Actor;
};

function stringFields(custom: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(custom)) {
    if (v === null || v === undefined) continue;
    out[k] = typeof v === "string" ? v : JSON.stringify(v);
  }
  return out;
}

function toneNotes(org: Organization): string | undefined {
  const notes = [org.voice?.tone, org.voice?.notes].map((s) => s?.trim()).filter(Boolean);
  return notes.length > 0 ? notes.join(". ") : undefined;
}

/** Owner feedback from rejected drafts for this lead, newest first (max 3). */
async function rejectionReasons(orgId: string, leadId: string): Promise<string[]> {
  const events = await agentEventsRepo.listForEntity(orgId, "lead", leadId, { limit: 30 });
  return events
    .filter((e) => e.type === "message.rejected")
    .map((e) => (e.input as { reason?: string | null } | null)?.reason)
    .filter((r): r is string => typeof r === "string" && r.length > 0)
    .slice(0, 3);
}

async function prepareForce(org: Organization, lead: Lead, deps?: ServiceDeps): Promise<Lead> {
  if (await messagesRepo.latestOutbound(org.id, lead.id, ["sent"])) {
    throw new ServiceError(
      "conflict",
      "This lead has already been replied to. Continue in the thread instead of re-processing.",
    );
  }
  const thread = await messagesRepo.listForLead(org.id, lead.id);
  for (const m of thread) {
    if (m.direction === "out" && (m.status === "draft" || m.status === "approved")) {
      if (m.status === "draft") await messagesRepo.reject(org.id, m.id, { now: nowFrom(deps) });
      else await messagesRepo.updateStatus(org.id, m.id, "rejected");
    }
  }
  if (lead.status !== "new") return (await leadsRepo.updateStatus(org.id, lead.id, "new")) ?? lead;
  return lead;
}

/**
 * Enrich, score, decide and draft for one lead. Idempotent and safe to retry:
 * a lead that is no longer "new", or already has an outbound message, is
 * skipped; a short lease (leads.claimForProcessing) stops two workers from
 * drafting at once.
 */
export async function processLead(
  orgId: string,
  leadId: string,
  options: ProcessOptions = {},
  deps?: ServiceDeps,
): Promise<ProcessResult> {
  const actor = options.actor ?? "agent";
  const [org, initial] = await Promise.all([organizationsRepo.getById(orgId), leadsRepo.getById(orgId, leadId)]);
  if (!org) throw new NotFoundError("Organization");
  if (!initial) throw new NotFoundError("Lead");

  let lead = initial;
  if (options.force) {
    lead = await prepareForce(org, lead, deps);
  } else {
    if (lead.status !== "new") return { status: "skipped", reason: `lead is ${lead.status}`, lead };
    if (lead.score !== null) {
      const thread = await messagesRepo.listForLead(orgId, leadId);
      if (thread.some((m) => m.direction === "out")) return { status: "skipped", reason: "already drafted", lead };
    }
  }

  const now = nowFrom(deps);
  const claimed = await leadsRepo.claimForProcessing(orgId, leadId, now);
  if (!claimed) return { status: "skipped", reason: "being processed by another worker", lead };
  lead = claimed;
  const claimStamp = lead.enrichment?.processingClaimedAt ?? now.toISOString();

  try {
    // 1. Enrich (spec 3.2 step 2), once per lead unless forced.
    let enrichment: LeadEnrichment = lead.enrichment ?? {};
    if (options.force || !enrichment.fetchedAt) {
      const fetched = await (deps?.enrich ?? ((d: string | null) => enrichDomain(d, now)))(lead.domain);
      enrichment = { ...fetched, processingClaimedAt: claimStamp };
      lead = (await leadsRepo.updateEnrichment(orgId, leadId, enrichment)) ?? lead;
      await audit({
        orgId,
        actor,
        type: "lead.enriched",
        entityType: "lead",
        entityId: leadId,
        input: { domain: fetched.domain ?? null },
        output: { ok: !fetched.error, error: fetched.error ?? null, title: fetched.title ?? null },
      });
    }

    // 2. Score (one model call) + deterministic adjustments.
    const scoreInput: ScoreInput = {
      businessName: org.name,
      rubric: rubricFor(org),
      offer: offerFor(org),
      lead: {
        name: lead.name ?? undefined,
        email: lead.email,
        company: lead.company ?? undefined,
        message: lead.message,
        source: promptSource(lead),
        customFields: stringFields(lead.custom),
        honeypotFilled: false,
      },
      enrichment: enrichment.error ? null : enrichment,
    };
    const scored = await runScore(scoreInput, deps);
    const { adjusted } = scored.result;
    const reasons = [...adjusted.reasons, ...adjusted.adjustments.map((a) => a.note)];
    lead = (await leadsRepo.updateScore(orgId, leadId, { score: adjusted.score, fit: adjusted.fit, reasons })) ?? lead;
    enrichment = { ...enrichment, leadSummary: adjusted.summary, scoreConfidence: adjusted.confidence };
    lead = (await leadsRepo.updateEnrichment(orgId, leadId, enrichment)) ?? lead;
    await audit({
      orgId,
      actor,
      type: "lead.scored",
      entityType: "lead",
      entityId: leadId,
      output: {
        score: adjusted.score,
        fit: adjusted.fit,
        modelScore: adjusted.modelScore,
        confidence: adjusted.confidence,
        adjustments: adjusted.adjustments.map((a) => a.code),
        fallback: scored.fallbackReason !== null,
      },
      meta: scored.result.meta,
    });

    // 3. Decide (spec 3.2 step 4).
    const action = decideAction(org, adjusted);
    if (action === "archive_spam") {
      lead = (await leadsRepo.updateStatus(orgId, leadId, "spam")) ?? lead;
      await audit({ orgId, actor, type: "lead.archived_spam", entityType: "lead", entityId: leadId });
      return { status: "processed", lead, action, messageId: null, autoSent: false, fallback: scored.fallbackReason !== null };
    }

    const signature = signatureFor(org);
    const leadForPrompt = { name: lead.name ?? undefined, company: lead.company ?? undefined, message: lead.message };
    const feedback = options.force ? await rejectionReasons(orgId, leadId) : [];

    if (action === "draft_decline") {
      const declined = await runDecline(
        {
          businessName: org.name,
          signature,
          toneNotes: toneNotes(org),
          lead: leadForPrompt,
          reason: adjusted.reasons.slice(0, 3).join("; ") || undefined,
          resourceUrl: org.voice?.declineResourceUrl?.trim() || undefined,
          offer: offerFor(org),
        },
        deps,
      );
      const message = await saveDraft(orgId, leadId, {
        kind: "decline",
        result: declined.result,
        fallbackReason: declined.fallbackReason,
        slots: [],
        actor,
      });
      return {
        status: "processed",
        lead,
        action,
        messageId: message.id,
        autoSent: false,
        fallback: scored.fallbackReason !== null || declined.fallbackReason !== null,
      };
    }

    // 4. Reply with three real slots (spec 3.3 / 3.4).
    const schedule = await loadSchedule(org, now);
    const slots = pickSlots(schedule, now, lead.leadTimezone);
    const slotStrings = formatSlots(slots, leadZone(lead, org));
    const drafted = await runReply(
      {
        kind: "first_reply",
        businessName: org.name,
        signature,
        toneNotes: toneNotes(org),
        offer: offerFor(org),
        bookingUrl: bookingUrlFor(org),
        slots: slotStrings,
        lead: leadForPrompt,
        enrichmentSummary: enrichment.error ? null : (enrichment.summary ?? null),
        scoreReasons: adjusted.reasons,
        rejectionReasons: feedback,
      },
      deps,
    );
    const message = await saveDraft(orgId, leadId, {
      kind: "reply",
      result: drafted.result,
      fallbackReason: drafted.fallbackReason,
      slots,
      actor,
    });

    let autoSent = false;
    if (action === "auto_reply" && slots.length > 0 && canAutoSend(org, lead, adjusted.confidence, drafted.result)) {
      const approved = await messagesRepo.approve(orgId, message.id, { userId: null, now });
      if (approved) {
        await audit({
          orgId,
          actor: "agent",
          type: "message.auto_approved",
          entityType: "message",
          entityId: message.id,
          input: { leadId, score: adjusted.score, confidence: drafted.result.draft.confidence },
        });
        autoSent = (await sendMessage(orgId, message.id, deps)).status === "sent";
      }
    }
    lead = (await leadsRepo.getById(orgId, leadId)) ?? lead;
    return {
      status: "processed",
      lead,
      action,
      messageId: message.id,
      autoSent,
      fallback: scored.fallbackReason !== null || drafted.fallbackReason !== null,
    };
  } catch (error) {
    await audit({
      orgId,
      actor,
      type: "lead.process_failed",
      entityType: "lead",
      entityId: leadId,
      output: { error: error instanceof Error ? error.message : String(error) },
    });
    throw error;
  } finally {
    await leadsRepo.releaseProcessing(orgId, leadId);
  }
}

/** Archive a lead by hand (owner action). */
export async function archiveLead(orgId: string, leadId: string, userId: string | null): Promise<Lead> {
  const lead = await leadsRepo.updateStatus(orgId, leadId, "archived");
  if (!lead) throw new NotFoundError("Lead");
  await audit({ orgId, actor: "user", type: "lead.archived", entityType: "lead", entityId: leadId, input: { userId } });
  return lead;
}

export type TickSummary = { processed: number; skipped: number; failed: number };

/** Cron tick: process leads that arrived but were never processed (crashed requests, outages). */
export async function processPendingLeads(options: { limit?: number } = {}, deps?: ServiceDeps): Promise<TickSummary> {
  const summary: TickSummary = { processed: 0, skipped: 0, failed: 0 };
  const pending = await leadsRepo.listUnprocessed({ limit: options.limit ?? 10 });
  for (const lead of pending) {
    try {
      const result = await processLead(lead.orgId, lead.id, { actor: "cron" }, deps);
      summary[result.status === "processed" ? "processed" : "skipped"] += 1;
    } catch (error) {
      console.error("[intake] processLead failed", lead.id, error instanceof Error ? error.message : error);
      summary.failed += 1;
    }
  }
  return summary;
}
