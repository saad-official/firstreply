import "server-only";
import * as leadsRepo from "@/lib/db/repositories/leads";
import * as meetingsRepo from "@/lib/db/repositories/meetings";
import * as messagesRepo from "@/lib/db/repositories/messages";
import * as organizationsRepo from "@/lib/db/repositories/organizations";
import * as slotOffersRepo from "@/lib/db/repositories/slotOffers";
import type {
  Actor,
  Lead,
  Meeting,
  Message,
  MessageClassification,
  Organization,
  SlotOffer,
} from "@/lib/db/types";
import { firstNameOf } from "@/lib/domain/guardrails";
import { handleReply, parseProposedStart, stripQuotedReply, type NegotiationOutcome } from "@/lib/domain/negotiation";
import { formatSlotFor, suggestSlots } from "@/lib/domain/slots";
import { isValidTimeZone, type ReplyIntent, type Slot } from "@/lib/domain/types";
import { canAutoSend, replySubject, saveDraft, saveStarterDraft } from "./drafting";
import { isSlotUnavailableError, NotFoundError, ServiceError } from "./errors";
import { runClassify, runReply, runSimulate } from "./models";
import { formatSlots, loadSchedule, slotFromOffer } from "./scheduling";
import { sendMessage } from "./sending";
import {
  audit,
  bookingUrlFor,
  leadZone,
  nowFrom,
  offerFor,
  signatureFor,
  type ServiceDeps,
} from "./shared";

/**
 * Reply reading (spec 3.5). The model only classifies; lib/domain/negotiation
 * decides, so a booking never depends on the model's view of availability.
 *
 * - book: meeting + confirmation with an .ics invite, sent at once (it only
 *   confirms what the lead chose); lead -> booked.
 * - counter: a draft with two alternatives; lead -> negotiating.
 * - draft_answer / review: no prompt answers questions, so the owner gets a
 *   starter draft in the queue explaining why it waits ("needs you").
 * - close: lead -> declined. follow_up_later: the inbound message carries
 *   followUpAt and the daily job drafts the follow-up when it is due.
 */

/** The most recent sent outbound message that offered slots, with its offers in the order shown. */
async function lastOffer(orgId: string, leadId: string): Promise<{ message: Message; offers: SlotOffer[] } | null> {
  const thread = await messagesRepo.listForLead(orgId, leadId);
  const sent = thread.filter((m) => m.direction === "out" && m.status === "sent").reverse();
  if (sent.length === 0) return null;
  const byMessage = await slotOffersRepo.listForMessages(
    orgId,
    sent.map((m) => m.id),
  );
  for (const message of sent) {
    const offers = byMessage.get(message.id);
    if (offers && offers.length > 0) return { message, offers };
  }
  return null;
}

function confirmationBody(org: Organization, lead: Lead, slot: Slot): { subject: string; body: string } {
  const zone = leadZone(lead, org);
  const when = formatSlotFor(slot, zone);
  const first = firstNameOf(lead.name);
  const day = when.split(",")[0];
  return {
    subject: `Confirmed: our call on ${day}`,
    body: [
      first ? `Hi ${first},` : "Hi there,",
      "",
      `You're booked for ${offerFor(org)}: ${when}.`,
      "",
      "A calendar invite is attached. If you need to move it, just reply to this email.",
      "",
      "Best,",
      signatureFor(org),
    ].join("\n"),
  };
}

export type BookResult = { meeting: Meeting; confirmationId: string; sent: boolean };

/**
 * Books `slot` for the lead, then stores and sends the confirmation.
 * Throws SlotUnavailableError when the time was taken in the meantime.
 */
export async function bookForLead(
  org: Organization,
  lead: Lead,
  slot: Slot,
  actor: Actor,
  deps?: ServiceDeps,
): Promise<BookResult> {
  const meeting = await meetingsRepo.create(org.id, { leadId: lead.id, startsAt: slot.start, endsAt: slot.end });
  const { subject, body } = confirmationBody(org, lead, slot);
  const confirmation = await messagesRepo.create(org.id, {
    leadId: lead.id,
    direction: "out",
    kind: "confirmation",
    subject,
    body,
    status: "approved",
    confidence: 1,
    rationale: "Booking confirmation (template).",
  });
  await leadsRepo.updateStatus(org.id, lead.id, "booked");
  await audit({
    orgId: org.id,
    actor,
    type: "meeting.booked",
    entityType: "meeting",
    entityId: meeting.id,
    input: { leadId: lead.id },
    output: { startsAt: slot.start.toISOString(), endsAt: slot.end.toISOString() },
  });
  const send = await sendMessage(org.id, confirmation.id, deps);
  return { meeting, confirmationId: confirmation.id, sent: send.status === "sent" };
}

function toStoredClassification(
  c: import("@/lib/domain/types").ReplyClassification,
  outcome: NegotiationOutcome,
  offers: readonly SlotOffer[],
  zone: string,
  fallback: boolean,
): MessageClassification {
  const proposedAt = c.proposedStart
    ? parseProposedStart(c.proposedStart, c.proposedTimezone && isValidTimeZone(c.proposedTimezone) ? c.proposedTimezone : zone)
    : null;
  return {
    intent: c.intent,
    slotOfferId: c.acceptedSlotIndex !== null ? (offers[c.acceptedSlotIndex]?.id ?? null) : null,
    proposedAt: proposedAt?.toISOString() ?? null,
    returnDate: c.returnDate,
    question: c.intent === "asks_question" ? c.summary : null,
    reason: c.intent === "not_interested" ? c.summary : null,
    confidence: c.confidence,
    summary: c.summary,
    action: outcome.action,
    followUpAt: outcome.followUpAt?.toISOString() ?? null,
    followUpDoneAt: null,
    classifier: fallback ? "fallback" : "model",
  };
}

export type InboundOptions = {
  subject?: string;
  simulated?: boolean;
  /** Use an inbound message already stored (dedupe merge) instead of creating one. */
  existingMessageId?: string;
  actor?: Actor;
};

export type InboundResult = {
  inboundMessageId: string;
  intent: ReplyIntent;
  action: NegotiationOutcome["action"];
  meetingId: string | null;
  draftMessageId: string | null;
  tasks: string[];
};

export async function handleInboundReply(
  orgId: string,
  leadId: string,
  body: string,
  receivedAt: Date,
  options: InboundOptions = {},
  deps?: ServiceDeps,
): Promise<InboundResult> {
  const actor = options.actor ?? "agent";
  const [org, lead] = await Promise.all([organizationsRepo.getById(orgId), leadsRepo.getById(orgId, leadId)]);
  if (!org) throw new NotFoundError("Organization");
  if (!lead) throw new NotFoundError("Lead");
  const text = body.trim().slice(0, 20_000);
  if (!text) throw new ServiceError("invalid_input", "The reply is empty.");

  const inbound = options.existingMessageId
    ? await messagesRepo.getById(orgId, options.existingMessageId)
    : await messagesRepo.create(orgId, {
        leadId,
        direction: "in",
        subject: options.subject?.slice(0, 200) ?? "",
        body: text,
        simulated: options.simulated ?? false,
        createdAt: receivedAt,
      });
  if (!inbound) throw new NotFoundError("Message");

  const now = nowFrom(deps);
  const zone = leadZone(lead, org);
  const offer = await lastOffer(orgId, leadId);
  const offers = offer?.offers ?? [];
  const offeredSlots = offers.map(slotFromOffer);

  const classified = await runClassify(
    {
      replyText: stripQuotedReply(text) || text,
      subject: options.subject,
      receivedAt,
      timezone: zone,
      offeredSlots: formatSlots(offeredSlots, zone),
    },
    deps,
  );
  const c = classified.result.classification;
  const schedule = await loadSchedule(org, now);
  const outcome = handleReply(c, {
    offeredSlots,
    policy: schedule.policy,
    rules: schedule.rules,
    busy: schedule.busy,
    now,
    leadTimezone: lead.leadTimezone ?? undefined,
  });
  await messagesRepo.setClassification(
    orgId,
    inbound.id,
    toStoredClassification(c, outcome, offers, zone, classified.fallbackReason !== null),
  );
  await audit({
    orgId,
    actor,
    type: "reply.classified",
    entityType: "message",
    entityId: inbound.id,
    input: { leadId, offered: offers.length, simulated: options.simulated ?? false },
    output: {
      intent: c.intent,
      confidence: c.confidence,
      action: outcome.action,
      fallback: classified.fallbackReason !== null,
    },
    meta: classified.result.meta,
  });

  const result: InboundResult = {
    inboundMessageId: inbound.id,
    intent: c.intent,
    action: outcome.action,
    meetingId: null,
    draftMessageId: null,
    tasks: outcome.tasks,
  };
  const subject = replySubject(offer?.message.subject ?? options.subject, `Following up from ${org.name}`);

  const draftCounter = async (slots: Slot[], why: string) => {
    const drafted = await runReply(
      {
        kind: "counter",
        businessName: org.name,
        signature: signatureFor(org),
        toneNotes: org.voice?.tone,
        offer: offerFor(org),
        bookingUrl: bookingUrlFor(org),
        slots: formatSlots(slots, zone),
        lead: { name: lead.name ?? undefined, company: lead.company ?? undefined, message: text },
        enrichmentSummary: lead.enrichment?.summary ?? null,
        scoreReasons: lead.scoreReasons,
      },
      deps,
    );
    const draft = { ...drafted.result, draft: { ...drafted.result.draft, subject } };
    const message = await saveDraft(orgId, leadId, {
      kind: "counter",
      result: draft,
      fallbackReason: drafted.fallbackReason,
      slots,
      actor,
    });
    await leadsRepo.updateStatus(orgId, leadId, "negotiating");
    await audit({ orgId, actor, type: "negotiation.countered", entityType: "lead", entityId: leadId, output: { why } });
    result.draftMessageId = message.id;
    if (canAutoSend(org, lead, lead.enrichment?.scoreConfidence, draft)) {
      if (await messagesRepo.approve(orgId, message.id, { userId: null, now })) await sendMessage(orgId, message.id, deps);
    }
  };

  switch (outcome.action) {
    case "book": {
      try {
        const booked = await bookForLead(org, lead, outcome.bookSlot!, actor, deps);
        result.meetingId = booked.meeting.id;
      } catch (error) {
        if (!isSlotUnavailableError(error)) throw error;
        // Taken between the check and the insert: counter with fresh times instead.
        const fresh = await loadSchedule(org, now);
        const alternatives = suggestSlots({
          rules: fresh.rules,
          busy: fresh.busy,
          policy: fresh.policy,
          now,
          count: 2,
          preferredTimezone: lead.leadTimezone ?? undefined,
        });
        result.action = "counter";
        if (alternatives.length > 0) await draftCounter(alternatives, "slot taken while booking");
        else {
          const starter = await saveStarterDraft(org, lead, {
            subject,
            why: "the chosen time was just taken and no other times are free in the booking horizon.",
            actor,
          });
          result.draftMessageId = starter.id;
        }
      }
      break;
    }
    case "counter":
      await draftCounter(outcome.counterSlots ?? [], outcome.tasks[0] ?? "counter");
      break;
    case "draft_answer": {
      const starter = await saveStarterDraft(org, lead, {
        subject,
        why: `the lead asked a question: ${c.summary}`,
        actor,
      });
      await leadsRepo.updateStatus(orgId, leadId, "negotiating");
      result.draftMessageId = starter.id;
      break;
    }
    case "review": {
      const starter = await saveStarterDraft(org, lead, {
        subject,
        why: outcome.tasks[0]?.replace(/^Review the reply: /, "") ?? c.summary,
        actor,
      });
      if (lead.status === "replied") await leadsRepo.updateStatus(orgId, leadId, "negotiating");
      result.draftMessageId = starter.id;
      break;
    }
    case "close":
      await leadsRepo.updateStatus(orgId, leadId, "declined");
      await audit({
        orgId,
        actor,
        type: "negotiation.closed",
        entityType: "lead",
        entityId: leadId,
        output: { reason: outcome.closeReason ?? null },
      });
      break;
    case "follow_up_later":
      await audit({
        orgId,
        actor,
        type: "negotiation.follow_up_scheduled",
        entityType: "lead",
        entityId: leadId,
        output: { followUpAt: outcome.followUpAt?.toISOString() ?? null },
      });
      break;
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* Demo: simulate the lead's reply                                     */
/* ------------------------------------------------------------------ */

export const SIMULATION_SCENARIOS = ["accept", "counter", "question", "decline", "out_of_office"] as const;
export type SimulationScenario = (typeof SIMULATION_SCENARIOS)[number];

const SCENARIO_INTENT: Record<SimulationScenario, ReplyIntent> = {
  accept: "accepts_slot",
  counter: "proposes_time",
  question: "asks_question",
  decline: "not_interested",
  out_of_office: "out_of_office",
};

/**
 * Writes a plausible reply from the lead with the chosen intent (stored with
 * simulated = true) and runs it through the real negotiation path.
 */
export async function simulateLeadReply(
  orgId: string,
  leadId: string,
  scenario: SimulationScenario,
  deps?: ServiceDeps,
): Promise<InboundResult & { body: string }> {
  if (!SIMULATION_SCENARIOS.includes(scenario)) throw new ServiceError("invalid_input", "Unknown scenario.");
  const [org, lead] = await Promise.all([organizationsRepo.getById(orgId), leadsRepo.getById(orgId, leadId)]);
  if (!org) throw new NotFoundError("Organization");
  if (!lead) throw new NotFoundError("Lead");
  const offer = await lastOffer(orgId, leadId);
  if (!offer) {
    throw new ServiceError("conflict", "Send a reply with times first: the simulated lead answers your last sent offer.");
  }
  const now = nowFrom(deps);
  const zone = leadZone(lead, org);
  const simulated = await runSimulate(
    {
      intent: SCENARIO_INTENT[scenario],
      leadName: lead.name ?? undefined,
      company: lead.company ?? undefined,
      ourSubject: offer.message.subject,
      ourBody: offer.message.body,
      offeredSlots: formatSlots(offer.offers.map(slotFromOffer), zone),
      leadTimezone: zone,
      now,
    },
    deps,
  );
  await audit({
    orgId,
    actor: "user",
    type: "reply.simulated",
    entityType: "lead",
    entityId: leadId,
    input: { scenario },
    output: { fallback: simulated.fallbackReason !== null },
    meta: simulated.result.meta,
  });
  const result = await handleInboundReply(
    orgId,
    leadId,
    simulated.result.reply.body,
    now,
    { subject: simulated.result.reply.subject, simulated: true, actor: "agent" },
    deps,
  );
  return { ...result, body: simulated.result.reply.body };
}
