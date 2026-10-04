import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { DbHandle } from "@/lib/db/client";
import * as leadsRepo from "@/lib/db/repositories/leads";
import * as messagesRepo from "@/lib/db/repositories/messages";
import * as outboxRepo from "@/lib/db/repositories/outbox";
import * as slotOffersRepo from "@/lib/db/repositories/slotOffers";
import type { Organization } from "@/lib/db/types";
import { ingestLead, processLead } from "@/lib/services/intake";
import { isPlanLimitError } from "@/lib/services/plan-limits";
import { insertOrg, startTestDb, stopTestDb } from "../db/helpers";
import { makeDeps, openEveryDay, stubScore } from "./helpers";

let handle: DbHandle;

beforeAll(async () => {
  handle = await startTestDb();
}, 120_000);

afterAll(async () => {
  await stopTestDb(handle);
});

const MESSAGE =
  "We are a 40-person software company planning a full website redesign before our spring launch. Could we talk about scope and timing next week?";

async function freshOrg(values: Partial<Organization> = {}): Promise<Organization> {
  const org = await insertOrg(handle, { name: "Northwind Studio", timezone: "Europe/London", ...values });
  await openEveryDay(org.id);
  return org;
}

describe("ingestLead", () => {
  let org: Organization;
  beforeEach(async () => {
    org = await freshOrg();
  });

  it("creates a lead and asks for processing", async () => {
    const result = await ingestLead(org.id, { email: "Maya@Lumen.example", name: "Maya", message: MESSAGE, source: "typeform" });
    expect(result.created).toBe(true);
    expect(result.needsProcessing).toBe(true);
    expect(result.lead.email).toBe("maya@lumen.example");
    expect(result.lead.source).toBe("webhook");
    expect(result.lead.sourceLabel).toBe("Typeform");
  });

  it("merges a second message from the same person within 30 days (Gmail dots and plus-tags)", async () => {
    const first = await ingestLead(org.id, { email: "jo.doe+site@gmail.com", message: "First message", source: "form" });
    const second = await ingestLead(org.id, { email: "JoDoe@googlemail.com", message: "Any update?", source: "form" });
    expect(second.created).toBe(false);
    expect(second.merged).toBe(true);
    expect(second.lead.id).toBe(first.lead.id);
    const thread = await messagesRepo.listForLead(org.id, first.lead.id);
    expect(thread.map((m) => [m.direction, m.body])).toEqual([["in", "Any update?"]]);
    expect(await leadsRepo.listForOrg(org.id)).toHaveLength(1);
  });

  it("does not merge a different company address", async () => {
    await ingestLead(org.id, { email: "jo+a@acme.example", message: "One", source: "form" });
    const other = await ingestLead(org.id, { email: "jo@acme.example", message: "Two", source: "form" });
    expect(other.created).toBe(true);
  });

  it("enforces the Free plan's 25 leads a month, but not for demo leads or Pro", async () => {
    for (let i = 0; i < 25; i++) {
      await leadsRepo.create(org.id, { source: "form", email: `lead${i}@example.org`, message: "hi" });
    }
    const error = await ingestLead(org.id, { email: "late@example.org", message: "hi", source: "form" }).catch((e) => e);
    expect(isPlanLimitError(error)).toBe(true);
    const demo = await ingestLead(org.id, { email: "demo@example.org", message: "hi", source: "demo" });
    expect(demo.created).toBe(true);

    const pro = await freshOrg({ plan: "pro" });
    for (let i = 0; i < 25; i++) {
      await leadsRepo.create(pro.id, { source: "form", email: `lead${i}@example.org`, message: "hi" });
    }
    expect((await ingestLead(pro.id, { email: "late@example.org", message: "hi", source: "form" })).created).toBe(true);
  });

  it("stores honeypot submissions as spam without processing and without using the allowance", async () => {
    const result = await ingestLead(org.id, { email: "bot@spam.example", message: "buy", source: "form", honeypotFilled: true });
    expect(result.spam).toBe(true);
    expect(result.needsProcessing).toBe(false);
    expect(result.lead.status).toBe("spam");
    expect(result.lead.fit).toBe("spam");
    expect(await leadsRepo.countBillableCreatedSince(org.id, new Date(0))).toBe(0);
  });
});

describe("processLead", () => {
  it("scores, drafts a reply with three slot offers and waits for approval", async () => {
    const org = await freshOrg();
    const deps = makeDeps();
    const { lead } = await ingestLead(org.id, { email: "maya@lumen.example", name: "Maya Okafor", message: MESSAGE, source: "form" });
    const result = await processLead(org.id, lead.id, {}, deps);
    expect(result.status).toBe("processed");
    if (result.status !== "processed") return;
    expect(result.action).toBe("draft_reply");
    expect(result.autoSent).toBe(false);
    const stored = await leadsRepo.getById(org.id, lead.id);
    expect(stored?.score).toBe(82);
    expect(stored?.fit).toBe("high");
    expect(stored?.status).toBe("new");
    expect(stored?.enrichment?.title).toBe("Acme Ltd");
    const message = await messagesRepo.getById(org.id, result.messageId!);
    expect(message?.status).toBe("draft");
    expect(message?.body).toContain("Hi Maya,");
    expect(await slotOffersRepo.listForMessage(org.id, result.messageId!)).toHaveLength(3);
    expect(deps.emailProvider.sent).toHaveLength(0);
  });

  it("is idempotent: a second run skips, and concurrent runs draft once", async () => {
    const org = await freshOrg();
    const deps = makeDeps();
    const { lead } = await ingestLead(org.id, { email: "a@acme.example", name: "Ann", message: MESSAGE, source: "form" });
    const results = await Promise.all([processLead(org.id, lead.id, {}, deps), processLead(org.id, lead.id, {}, deps)]);
    expect(results.filter((r) => r.status === "processed")).toHaveLength(1);
    const again = await processLead(org.id, lead.id, {}, deps);
    expect(again.status).toBe("skipped");
    const thread = await messagesRepo.listForLead(org.id, lead.id);
    expect(thread.filter((m) => m.direction === "out")).toHaveLength(1);
  });

  it("archives spam and drafts a decline for a low fit", async () => {
    const org = await freshOrg();
    const spam = await ingestLead(org.id, { email: "seo@rank.example", message: MESSAGE, source: "form" });
    const spamResult = await processLead(org.id, spam.lead.id, {}, makeDeps({ scoreLead: stubScore(5, "spam") }));
    expect(spamResult.status === "processed" && spamResult.action).toBe("archive_spam");
    expect((await leadsRepo.getById(org.id, spam.lead.id))?.status).toBe("spam");

    const low = await ingestLead(org.id, { email: "student@uni.example", name: "Sam", message: MESSAGE, source: "form" });
    const lowResult = await processLead(org.id, low.lead.id, {}, makeDeps({ scoreLead: stubScore(25, "low") }));
    expect(lowResult.status === "processed" && lowResult.action).toBe("draft_decline");
    const [decline] = await messagesRepo.listForLead(org.id, low.lead.id);
    expect(decline.kind).toBe("decline");
    expect(decline.status).toBe("draft");
  });

  it("auto-sends on Pro with auto-reply on for a high-fit, high-confidence lead", async () => {
    const org = await freshOrg({ plan: "pro", autonomy: "auto_high_score" });
    const deps = makeDeps();
    const { lead } = await ingestLead(org.id, { email: "cto@bigco.example", name: "Lee Chan", message: MESSAGE, source: "form" });
    const result = await processLead(org.id, lead.id, {}, deps);
    expect(result.status === "processed" && result.autoSent).toBe(true);
    const stored = await leadsRepo.getById(org.id, lead.id);
    expect(stored?.status).toBe("replied");
    expect(stored?.firstReplyAt).not.toBeNull();
    expect(deps.emailProvider.sent).toHaveLength(1);
    expect(deps.emailProvider.sent[0].to).toBe("cto@bigco.example");
    const outbox = await outboxRepo.listForOrg(org.id);
    expect(outbox[0].status).toBe("sent");
  });

  it("never auto-sends on Free, whatever the score", async () => {
    const org = await freshOrg({ autonomy: "auto_high_score" });
    const deps = makeDeps();
    const { lead } = await ingestLead(org.id, { email: "x@bigco.example", name: "Lee", message: MESSAGE, source: "form" });
    const result = await processLead(org.id, lead.id, {}, deps);
    expect(result.status === "processed" && result.autoSent).toBe(false);
    expect(deps.emailProvider.sent).toHaveLength(0);
  });

  it("falls back to a template when the model is unavailable", async () => {
    const org = await freshOrg({ plan: "pro", autonomy: "auto_high_score" });
    const unavailable = async () => {
      throw Object.assign(new Error("No LLM provider is configured."), { name: "AiUnavailableError" });
    };
    const deps = makeDeps({ scoreLead: unavailable, draftReply: unavailable });
    const { lead } = await ingestLead(org.id, { email: "maya@lumen.example", name: "Maya", company: "Lumen", message: MESSAGE, source: "form" });
    const result = await processLead(org.id, lead.id, {}, deps);
    expect(result.status === "processed" && result.fallback).toBe(true);
    expect(result.status === "processed" && result.autoSent).toBe(false);
    const [draft] = await messagesRepo.listForLead(org.id, lead.id);
    expect(draft.status).toBe("draft");
    expect(draft.rationale).toMatch(/template/i);
    expect(draft.confidence ?? 1).toBeLessThan(0.8);
  });

  it("re-processing rejects the unsent draft and drafts again", async () => {
    const org = await freshOrg();
    const deps = makeDeps();
    const { lead } = await ingestLead(org.id, { email: "re@acme.example", name: "Rae", message: MESSAGE, source: "form" });
    await processLead(org.id, lead.id, {}, deps);
    const again = await processLead(org.id, lead.id, { force: true }, deps);
    expect(again.status).toBe("processed");
    const thread = await messagesRepo.listForLead(org.id, lead.id);
    expect(thread.map((m) => m.status)).toEqual(["rejected", "draft"]);
  });
});
