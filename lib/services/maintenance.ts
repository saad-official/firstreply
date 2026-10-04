import "server-only";
import type { DraftResult } from "@/lib/ai/prompts/reply";
import * as leadsRepo from "@/lib/db/repositories/leads";
import * as messagesRepo from "@/lib/db/repositories/messages";
import * as organizationsRepo from "@/lib/db/repositories/organizations";
import * as outboxRepo from "@/lib/db/repositories/outbox";
import * as slotOffersRepo from "@/lib/db/repositories/slotOffers";
import type { Message, Organization } from "@/lib/db/types";
import { firstNameOf, validateReplyDraft } from "@/lib/domain/guardrails";
import { canAutoSend, saveDraft } from "./drafting";
import { formatSlots, loadSchedule, pickSlots, slotFromOffer } from "./scheduling";
import { retryOutboxRow, sendMessage } from "./sending";
import {
  audit,
  bookingUrlFor,
  errorText,
  leadZone,
  nowFrom,
  offerFor,
  signatureFor,
  type ServiceDeps,
} from "./shared";

/**
 * Daily job (GET /api/cron/daily, 06:00 UTC):
 * 1. Refresh drafts whose offered times went stale while they waited for
 *    approval (a slot inside the minimum notice or in the past).
 * 2. Draft follow-ups that are due (out-of-office replies).
 * 3. Retry failed deliveries from the last three days.
 * 4. Purge leads past retention.
 *
 * Retention (spec silent): leads untouched for LEAD_RETENTION_DAYS (180) are
 * deleted with their thread, slot offers, meetings and outbox copies, unless
 * a booked meeting is still ahead. agent_events is append-only and keeps ids
 * and scores, never message text.
 */

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
export const LEAD_RETENTION_DAYS = 180;
export const OUTBOX_RETRY_DAYS = 3;
const CLOSED = new Set(["booked", "declined", "spam", "archived"]);

/** Same text, every outdated slot line swapped for its replacement; null when the owner edited a slot line away. */
export function replaceSlotLines(body: string, oldSlots: readonly string[], newSlots: readonly string[]): string | null {
  if (oldSlots.length !== newSlots.length) return null;
  let out = body;
  for (let i = 0; i < oldSlots.length; i++) {
    if (!out.includes(oldSlots[i])) return null;
    out = out.replace(oldSlots[i], newSlots[i]);
  }
  return out;
}

export async function refreshStaleDrafts(now: Date): Promise<{ refreshed: number; stale: number }> {
  const result = { refreshed: 0, stale: 0 };
  const drafts = await messagesRepo.listDrafts({ limit: 200 });
  const orgs = new Map<string, Organization | null>();
  for (const draft of drafts) {
    const offers = await slotOffersRepo.listForMessage(draft.orgId, draft.id);
    if (offers.length === 0) continue;
    if (!orgs.has(draft.orgId)) orgs.set(draft.orgId, await organizationsRepo.getById(draft.orgId));
    const org = orgs.get(draft.orgId);
    if (!org) continue;
    const cutoff = now.getTime() + org.minNoticeHours * HOUR_MS;
    if (offers.every((o) => o.startsAt.getTime() >= cutoff)) continue;
    const lead = await leadsRepo.getById(org.id, draft.leadId);
    if (!lead) continue;
    const zone = leadZone(lead, org);
    const schedule = await loadSchedule(org, now);
    const fresh = pickSlots(schedule, now, lead.leadTimezone, offers.length);
    const body =
      fresh.length === offers.length
        ? replaceSlotLines(draft.body, formatSlots(offers.map(slotFromOffer), zone), formatSlots(fresh, zone))
        : null;
    if (!body) {
      result.stale += 1;
      await audit({
        orgId: org.id,
        actor: "cron",
        type: "draft.slots_stale",
        entityType: "message",
        entityId: draft.id,
        input: { leadId: lead.id },
      });
      continue;
    }
    await messagesRepo.updateContent(org.id, draft.id, { body });
    await slotOffersRepo.replaceForMessage(
      org.id,
      draft.id,
      fresh.map((s) => ({ startsAt: s.start, endsAt: s.end })),
    );
    result.refreshed += 1;
    await audit({
      orgId: org.id,
      actor: "cron",
      type: "draft.slots_refreshed",
      entityType: "message",
      entityId: draft.id,
      input: { leadId: lead.id },
      output: { slots: fresh.length },
    });
  }
  return result;
}

function followUpBody(org: Organization, leadName: string | null, slots: string[]): string {
  const first = firstNameOf(leadName);
  return [
    first ? `Hi ${first},` : "Hi there,",
    "",
    `Welcome back, and I hope the time away was good. I wanted to follow up on my earlier note about ${offerFor(org)}. If it is still useful, here are three fresh times:`,
    ...slots.map((s) => `- ${s}`),
    "",
    `Or pick any open time here: ${bookingUrlFor(org)}`,
    "",
    "No pressure if the timing is not right; just let me know.",
    "",
    "Best,",
    signatureFor(org),
  ].join("\n");
}

export async function sendDueFollowUps(now: Date, deps?: ServiceDeps): Promise<{ drafted: number; sent: number; skipped: number }> {
  const result = { drafted: 0, sent: 0, skipped: 0 };
  const due = await messagesRepo.listDueFollowUps(now, { limit: 50 });
  for (const inbound of due) {
    // Mark first so a crash never drafts the same follow-up twice.
    await messagesRepo.setClassification(inbound.orgId, inbound.id, {
      ...inbound.classification!,
      followUpDoneAt: now.toISOString(),
    });
    const [org, lead] = await Promise.all([
      organizationsRepo.getById(inbound.orgId),
      leadsRepo.getById(inbound.orgId, inbound.leadId),
    ]);
    if (!org || !lead || CLOSED.has(lead.status)) {
      result.skipped += 1;
      continue;
    }
    const thread = await messagesRepo.listForLead(org.id, lead.id);
    const newer = thread.some((m: Message) => m.createdAt.getTime() > inbound.createdAt.getTime() && m.id !== inbound.id);
    if (newer) {
      result.skipped += 1;
      continue;
    }
    const zone = leadZone(lead, org);
    const slots = pickSlots(await loadSchedule(org, now), now, lead.leadTimezone);
    const slotStrings = formatSlots(slots, zone);
    const lastSubject = thread.filter((m) => m.direction === "out").at(-1)?.subject;
    const draft = {
      subject: lastSubject ? (/^re:/i.test(lastSubject) ? lastSubject : `Re: ${lastSubject}`) : `Following up from ${org.name}`,
      body: followUpBody(org, lead.name, slotStrings),
      confidence: 0.9,
      rationale: "Follow-up after the lead's out-of-office reply (template).",
    };
    const validation = validateReplyDraft(draft, {
      slots: slotStrings,
      bookingUrl: bookingUrlFor(org),
      firstName: firstNameOf(lead.name),
      signature: signatureFor(org),
      offer: offerFor(org),
    });
    const drafted: DraftResult = {
      draft: { ...draft, confidence: validation.adjustedConfidence },
      validation,
      meta: { model: "template", promptVersion: "followup/v1", tokensIn: 0, tokensOut: 0, latencyMs: 0, attempts: 0 },
    };
    const message = await saveDraft(org.id, lead.id, {
      kind: "reply",
      result: drafted,
      fallbackReason: null,
      slots,
      actor: "cron",
    });
    result.drafted += 1;
    await audit({ orgId: org.id, actor: "cron", type: "followup.drafted", entityType: "lead", entityId: lead.id });
    if (slots.length > 0 && canAutoSend(org, lead, lead.enrichment?.scoreConfidence, drafted)) {
      if (await messagesRepo.approve(org.id, message.id, { userId: null, now })) {
        if ((await sendMessage(org.id, message.id, deps)).status === "sent") result.sent += 1;
      }
    }
  }
  return result;
}

export async function retryFailedOutbox(now: Date, deps?: ServiceDeps): Promise<{ resent: number; failed: number; skipped: number }> {
  const result = { resent: 0, failed: 0, skipped: 0 };
  const failed = await outboxRepo.listFailed(new Date(now.getTime() - OUTBOX_RETRY_DAYS * DAY_MS), { limit: 50 });
  for (const row of failed) {
    try {
      const outcome = await retryOutboxRow(row, deps);
      if (outcome.status === "sent") result.resent += 1;
      else if (outcome.status === "failed") result.failed += 1;
      else result.skipped += 1;
    } catch (error) {
      console.error("[maintenance] outbox retry", row.id, errorText(error));
      result.failed += 1;
    }
  }
  return result;
}

export type MaintenanceSummary = {
  drafts: Awaited<ReturnType<typeof refreshStaleDrafts>>;
  followUps: Awaited<ReturnType<typeof sendDueFollowUps>>;
  outbox: Awaited<ReturnType<typeof retryFailedOutbox>>;
  purgedLeads: number;
  errors: string[];
};

export async function runDailyMaintenance(deps?: ServiceDeps): Promise<MaintenanceSummary> {
  const now = nowFrom(deps);
  const errors: string[] = [];
  const step = async <T>(label: string, fn: () => Promise<T>, empty: T): Promise<T> => {
    try {
      return await fn();
    } catch (error) {
      errors.push(`${label}: ${errorText(error)}`);
      return empty;
    }
  };
  const drafts = await step("drafts", () => refreshStaleDrafts(now), { refreshed: 0, stale: 0 });
  const followUps = await step("follow-ups", () => sendDueFollowUps(now, deps), { drafted: 0, sent: 0, skipped: 0 });
  const outbox = await step("outbox", () => retryFailedOutbox(now, deps), { resent: 0, failed: 0, skipped: 0 });
  const purgedLeads = await step(
    "retention",
    () => leadsRepo.purgeOlderThan(new Date(now.getTime() - LEAD_RETENTION_DAYS * DAY_MS), now),
    0,
  );
  await audit({
    orgId: null,
    actor: "cron",
    type: "maintenance.daily",
    output: { drafts, followUps, outbox, purgedLeads, errors: errors.length },
  });
  return { drafts, followUps, outbox, purgedLeads, errors };
}
