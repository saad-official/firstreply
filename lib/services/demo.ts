import "server-only";
import * as availabilityRepo from "@/lib/db/repositories/availability";
import * as formsRepo from "@/lib/db/repositories/forms";
import * as leadsRepo from "@/lib/db/repositories/leads";
import * as messagesRepo from "@/lib/db/repositories/messages";
import * as organizationsRepo from "@/lib/db/repositories/organizations";
import * as slotOffersRepo from "@/lib/db/repositories/slotOffers";
import * as webhookTokensRepo from "@/lib/db/repositories/webhookTokens";
import type { Lead, Organization } from "@/lib/db/types";
import { addDaysToIsoDate, isoDateInZone } from "@/lib/domain/dates";
import {
  DEMO_FIRST_REPLY_SECONDS,
  DEMO_LEADS,
  DEMO_OFFER,
  DEMO_OOO_KEY,
  DEMO_OOO_REPLY,
  DEMO_RUBRIC,
  DEMO_VOICE,
} from "./demo-data";
import { fallbackReply } from "./fallbacks";
import { processLead } from "./intake";
import { handleInboundReply } from "./negotiation";
import { formatSlots, loadSchedule, pickSlots } from "./scheduling";
import { audit, bookingUrlFor, errorText, leadZone, nowFrom, offerFor, signatureFor, type ServiceDeps } from "./shared";

/**
 * "Load demo workspace" (spec 3.7): fills an empty workspace with a
 * fictional design studio's rubric, offer and voice (only where the owner
 * has not set their own; the workspace name is never changed), Mon-Fri
 * 09:00-17:00 availability when there is none, one hosted form, one webhook
 * token, and six synthetic leads (source "demo", exempt from plan limits)
 * that run through the real processLead so the queue fills at once. One lead
 * already has a sent reply and an out-of-office answer, so the dashboard has
 * a first-response time and a scheduled follow-up.
 *
 * Idempotent: when demo leads exist nothing is created.
 */

export type SeedDemoResult = { leads: Lead[]; created: boolean; errors: string[] };

const MINUTE_MS = 60_000;
const CONCURRENCY = 3;

async function ensureSettings(org: Organization): Promise<Organization> {
  const patch: organizationsRepo.OrganizationSettings = {};
  if (!org.rubric.trim()) patch.rubric = DEMO_RUBRIC;
  if (!org.offer.trim()) patch.offer = DEMO_OFFER;
  const voice = { ...org.voice };
  let voiceChanged = false;
  for (const [key, value] of Object.entries(DEMO_VOICE) as Array<[keyof typeof DEMO_VOICE, string]>) {
    if (!voice[key]) {
      voice[key] = value;
      voiceChanged = true;
    }
  }
  if (voiceChanged) patch.voice = voice;
  if (Object.keys(patch).length === 0) return org;
  return (await organizationsRepo.updateSettings(org.id, patch)) ?? org;
}

async function ensureCapture(org: Organization): Promise<void> {
  if ((await availabilityRepo.listRules(org.id)).length === 0) {
    await availabilityRepo.replaceRules(org.id, availabilityRepo.DEFAULT_AVAILABILITY);
  }
  if ((await formsRepo.listForOrg(org.id)).length === 0) {
    await formsRepo.create(org.id, { name: "Website contact form", slugBase: org.bookingSlug });
  }
  if ((await webhookTokensRepo.listForOrg(org.id)).length === 0) {
    await webhookTokensRepo.create(org.id, { sourceLabel: "Typeform (demo)" });
  }
}

/** Seeds the out-of-office lead's history: a reply sent 42 s after it arrived, then an automatic reply back. */
async function seedOutOfOfficeThread(org: Organization, lead: Lead, now: Date, deps?: ServiceDeps): Promise<void> {
  const schedule = await loadSchedule(org, now);
  const slots = pickSlots(schedule, now, lead.leadTimezone);
  const zone = leadZone(lead, org);
  const template = fallbackReply({
    kind: "first_reply",
    businessName: org.name,
    signature: signatureFor(org),
    offer: offerFor(org),
    bookingUrl: bookingUrlFor(org),
    slots: formatSlots(slots, zone),
    lead: { name: lead.name ?? undefined, company: lead.company ?? undefined, message: lead.message },
  });
  const sentAt = new Date(lead.createdAt.getTime() + DEMO_FIRST_REPLY_SECONDS * 1000);
  const reply = await messagesRepo.create(org.id, {
    leadId: lead.id,
    direction: "out",
    kind: "reply",
    subject: template.draft.subject,
    body: template.draft.body,
    status: "approved",
    confidence: 0.9,
    rationale: "Demo history: sent before the workspace was loaded.",
    createdAt: new Date(sentAt.getTime() - 5_000),
  });
  if (slots.length > 0) {
    await slotOffersRepo.createMany(org.id, reply.id, slots.map((s) => ({ startsAt: s.start, endsAt: s.end })));
  }
  await messagesRepo.markSent(org.id, reply.id, sentAt);
  await leadsRepo.setFirstReplyAt(org.id, lead.id, sentAt);
  await leadsRepo.updateScore(org.id, lead.id, {
    score: 78,
    fit: "high",
    reasons: ["Multi-site clinic group planning a new website", "Clear project and timeline", "Decision maker writing"],
  });
  await leadsRepo.updateStatus(org.id, lead.id, "replied");
  const returnDate = addDaysToIsoDate(isoDateInZone(now, org.timezone), 3);
  await handleInboundReply(
    org.id,
    lead.id,
    DEMO_OOO_REPLY(returnDate),
    new Date(lead.createdAt.getTime() + 2 * 60 * MINUTE_MS),
    { subject: `Automatic reply: ${template.draft.subject}`, simulated: true, actor: "agent" },
    deps,
  );
}

export async function seedDemoWorkspace(input: Organization, deps?: ServiceDeps): Promise<SeedDemoResult> {
  const existing = (await leadsRepo.listForOrg(input.id, { limit: 500 })).filter((l) => l.source === "demo");
  if (existing.length > 0) return { leads: existing, created: false, errors: [] };

  const now = nowFrom(deps);
  const org = await ensureSettings(input);
  await ensureCapture(org);

  const created: Lead[] = [];
  for (const demo of DEMO_LEADS) {
    const lead = await leadsRepo.create(org.id, {
      source: "demo",
      sourceLabel: demo.key === DEMO_OOO_KEY ? "Website contact form (demo)" : "Demo",
      name: demo.name,
      email: demo.email,
      company: demo.company ?? null,
      message: demo.message,
      leadTimezone: demo.leadTimezone,
      createdAt: new Date(now.getTime() - demo.minutesAgo * MINUTE_MS),
    });
    created.push(lead);
  }

  const errors: string[] = [];
  const toProcess = created.filter((_, i) => DEMO_LEADS[i].key !== DEMO_OOO_KEY);
  for (let i = 0; i < toProcess.length; i += CONCURRENCY) {
    await Promise.all(
      toProcess.slice(i, i + CONCURRENCY).map(async (lead) => {
        try {
          await processLead(org.id, lead.id, { actor: "agent" }, deps);
        } catch (error) {
          errors.push(`${lead.name}: ${errorText(error)}`);
        }
      }),
    );
  }
  const ooo = created[DEMO_LEADS.findIndex((d) => d.key === DEMO_OOO_KEY)];
  if (ooo) {
    try {
      await seedOutOfOfficeThread(org, ooo, now, deps);
    } catch (error) {
      errors.push(`${ooo.name}: ${errorText(error)}`);
    }
  }
  await audit({
    orgId: org.id,
    actor: "user",
    type: "demo.seeded",
    entityType: "organization",
    entityId: org.id,
    output: { leads: created.length, errors: errors.length },
  });
  const leads = (await leadsRepo.listForOrg(org.id, { limit: 500 })).filter((l) => l.source === "demo");
  return { leads, created: true, errors };
}
