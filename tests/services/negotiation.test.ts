import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { DbHandle } from "@/lib/db/client";
import * as leadsRepo from "@/lib/db/repositories/leads";
import * as meetingsRepo from "@/lib/db/repositories/meetings";
import * as messagesRepo from "@/lib/db/repositories/messages";
import * as slotOffersRepo from "@/lib/db/repositories/slotOffers";
import type { Lead, Organization } from "@/lib/db/types";
import { ingestLead, processLead } from "@/lib/services/intake";
import { sendDueFollowUps } from "@/lib/services/maintenance";
import { handleInboundReply, simulateLeadReply } from "@/lib/services/negotiation";
import { approveMessage, editAndApproveMessage } from "@/lib/services/sending";
import { isServiceError } from "@/lib/services/errors";
import { insertOrg, startTestDb, stopTestDb } from "../db/helpers";
import { makeDeps, openEveryDay, stubClassify } from "./helpers";

let handle: DbHandle;

beforeAll(async () => {
  handle = await startTestDb();
}, 120_000);

afterAll(async () => {
  await stopTestDb(handle);
});

const MESSAGE =
  "We are a 40-person software company planning a full website redesign before our spring launch. Could we talk about scope and timing next week?";

/** An org and a lead whose first reply (three slots) has been approved and sent. */
async function leadWithSentOffer(): Promise<{ org: Organization; lead: Lead; offerIds: string[] }> {
  const org = await insertOrg(handle, { name: "Northwind Studio", timezone: "Europe/London" });
  await openEveryDay(org.id);
  const deps = makeDeps();
  const email = `lead-${Math.random().toString(36).slice(2, 8)}@acme.example`;
  const { lead } = await ingestLead(org.id, { email, name: "Maya Okafor", message: MESSAGE, source: "form", leadTimezone: "Europe/London" });
  const processed = await processLead(org.id, lead.id, {}, deps);
  if (processed.status !== "processed" || !processed.messageId) throw new Error("not drafted");
  await approveMessage(org.id, processed.messageId, null, deps);
  const offers = await slotOffersRepo.listForMessage(org.id, processed.messageId);
  return { org, lead: (await leadsRepo.getById(org.id, lead.id))!, offerIds: offers.map((o) => o.id) };
}

describe("handleInboundReply", () => {
  it("books an accepted slot and sends the confirmation with an .ics invite", async () => {
    const { org, lead, offerIds } = await leadWithSentOffer();
    const deps = makeDeps({ classifyReply: stubClassify({ intent: "accepts_slot", acceptedSlotIndex: 1 }) });
    const result = await handleInboundReply(org.id, lead.id, "The second one works for me. Maya", new Date(), {}, deps);
    expect(result.action).toBe("book");
    expect(result.meetingId).not.toBeNull();
    const offer = await slotOffersRepo.getById(org.id, offerIds[1]);
    const meeting = await meetingsRepo.getById(org.id, result.meetingId!);
    expect(meeting?.startsAt.toISOString()).toBe(offer?.startsAt.toISOString());
    expect((await leadsRepo.getById(org.id, lead.id))?.status).toBe("booked");
    const [mail] = deps.emailProvider.sent;
    expect(mail.subject).toMatch(/^Confirmed:/);
    expect(mail.attachments?.[0].filename).toBe("invite.ics");
    expect(mail.attachments?.[0].content).toContain(`UID:${meeting?.icsUid}`);
    const inbound = await messagesRepo.getById(org.id, result.inboundMessageId);
    expect(inbound?.classification?.intent).toBe("accepts_slot");
    expect(inbound?.classification?.slotOfferId).toBe(offerIds[1]);
  });

  it("counters with two alternatives when the proposed time is outside availability", async () => {
    const { org, lead } = await leadWithSentOffer();
    const deps = makeDeps({
      classifyReply: stubClassify({ intent: "proposes_time", proposedStart: "2099-01-01T03:00", proposedTimezone: "Europe/London" }),
    });
    const result = await handleInboundReply(org.id, lead.id, "How about 3am on new year's day 2099?", new Date(), {}, deps);
    expect(result.action).toBe("counter");
    const draft = await messagesRepo.getById(org.id, result.draftMessageId!);
    expect(draft?.kind).toBe("counter");
    expect(draft?.status).toBe("draft");
    expect(draft?.subject).toMatch(/^Re:/);
    expect(await slotOffersRepo.listForMessage(org.id, draft!.id)).toHaveLength(2);
    expect((await leadsRepo.getById(org.id, lead.id))?.status).toBe("negotiating");
  });

  it("closes the lead when they are not interested", async () => {
    const { org, lead } = await leadWithSentOffer();
    const deps = makeDeps({ classifyReply: stubClassify({ intent: "not_interested", summary: "Went with another studio." }) });
    const result = await handleInboundReply(org.id, lead.id, "We went with another studio, thanks.", new Date(), {}, deps);
    expect(result.action).toBe("close");
    expect((await leadsRepo.getById(org.id, lead.id))?.status).toBe("declined");
  });

  it("puts a question in the queue as a starter draft that cannot be sent unanswered", async () => {
    const { org, lead } = await leadWithSentOffer();
    const deps = makeDeps({ classifyReply: stubClassify({ intent: "asks_question", summary: "Asks who joins the call." }) });
    const result = await handleInboundReply(org.id, lead.id, "Who would join from your side?", new Date(), {}, deps);
    expect(result.action).toBe("draft_answer");
    const draft = await messagesRepo.getById(org.id, result.draftMessageId!);
    expect(draft?.kind).toBe("question_answer");
    expect(draft?.rationale).toMatch(/^Needs you:/);
    const refused = await approveMessage(org.id, draft!.id, null, deps).catch((e) => e);
    expect(isServiceError(refused)).toBe(true);
    const sent = await editAndApproveMessage(
      org.id,
      draft!.id,
      { subject: draft!.subject, body: "Hi Maya,\n\nIt will be me and our lead designer.\n\nBest,\nRobin" },
      null,
      deps,
    );
    expect(sent.send.status).toBe("sent");
  });

  it("schedules a follow-up after an out-of-office reply and drafts it when due", async () => {
    const { org, lead } = await leadWithSentOffer();
    const deps = makeDeps({ classifyReply: stubClassify({ intent: "out_of_office", returnDate: "2099-03-02" }) });
    const result = await handleInboundReply(org.id, lead.id, "I am away until 2 March.", new Date(), {}, deps);
    expect(result.action).toBe("follow_up_later");
    const inbound = await messagesRepo.getById(org.id, result.inboundMessageId);
    const followUpAt = new Date(inbound!.classification!.followUpAt!);
    expect(followUpAt.getTime()).toBeGreaterThan(new Date("2099-03-02T00:00:00Z").getTime());

    const early = await sendDueFollowUps(new Date("2099-03-01T00:00:00Z"), deps);
    expect(early.drafted).toBe(0);
    const due = await sendDueFollowUps(new Date(followUpAt.getTime() + 60_000), deps);
    expect(due.drafted).toBeGreaterThanOrEqual(1);
    const thread = await messagesRepo.listForLead(org.id, lead.id);
    expect(thread.at(-1)?.kind).toBe("reply");
    expect(thread.at(-1)?.status).toBe("draft");
    const again = await sendDueFollowUps(new Date(followUpAt.getTime() + 120_000), deps);
    expect(again.drafted).toBe(0);
  });

  it("simulates a lead reply through the real negotiation path", async () => {
    const { org, lead } = await leadWithSentOffer();
    const deps = makeDeps({ simulateLeadReply: undefined, classifyReply: undefined });
    // No model in tests: the simulator and classifier fall back to their keyword versions.
    const unavailable = async () => {
      throw Object.assign(new Error("No LLM provider is configured."), { name: "AiUnavailableError" });
    };
    const result = await simulateLeadReply(org.id, lead.id, "accept", { ...deps, simulateLeadReply: unavailable, classifyReply: unavailable });
    expect(result.intent).toBe("accepts_slot");
    expect(result.action).toBe("book");
    const inbound = await messagesRepo.getById(org.id, result.inboundMessageId);
    expect(inbound?.simulated).toBe(true);
    expect((await leadsRepo.getById(org.id, lead.id))?.status).toBe("booked");
  });
});
