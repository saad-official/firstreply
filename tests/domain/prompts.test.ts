import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/ai/generate", () => ({ generateStructured: vi.fn() }));

import { generateStructured } from "@/lib/ai/generate";
import {
  buildClassifyPrompt,
  CLASSIFY_INSTRUCTIONS,
  CLASSIFY_PROMPT_VERSION,
  classifyReply,
  type ClassifyInput,
} from "@/lib/ai/prompts/classify";
import {
  buildDeclinePrompt,
  buildReplyPrompt,
  DECLINE_INSTRUCTIONS,
  DECLINE_PROMPT_VERSION,
  draftDecline,
  draftReply,
  REPLY_INSTRUCTIONS,
  REPLY_PROMPT_VERSION,
  type DeclineInput,
  type ReplyInput,
} from "@/lib/ai/prompts/reply";
import { buildScorePrompt, SCORE_PROMPT_VERSION, scoreLead, type ScoreInput } from "@/lib/ai/prompts/score";
import {
  buildSimulatePrompt,
  SIMULATE_PROMPT_VERSION,
  SimulatedReplySchema,
  simulateLeadReply,
} from "@/lib/ai/prompts/simulate-lead-reply";
import { ReplyClassificationSchema, ReplyDraftSchema, ScoreOutputSchema, REPLY_INTENTS } from "@/lib/domain/types";

const generate = vi.mocked(generateStructured);
const META = { model: "test-model", promptVersion: "x", tokensIn: 1, tokensOut: 1, latencyMs: 1, attempts: 1 };

beforeEach(() => {
  generate.mockReset();
});

const SLOTS = [
  "Tue 6 Oct, 10:30–11:00 (Europe/London)",
  "Wed 7 Oct, 14:00–14:30 (Europe/London)",
  "Thu 8 Oct, 10:00–10:30 (Europe/London)",
];
const BOOKING_URL = "https://firstreply.app/b/brightpath";

describe("score prompt", () => {
  const input: ScoreInput = {
    businessName: "Brightpath Studio",
    rubric: "B2B SaaS 10-200 people in UK/EU; budget signals; not agencies.",
    offer: "20-minute intro call",
    lead: {
      name: "Maya Patel",
      email: "maya@gmail.com",
      company: "Northwind Analytics",
      message: "Need help with onboarding before Q1, team of 40.",
      source: "form",
      customFields: { budget: "10-25k" },
    },
    enrichment: { title: "Northwind Analytics", description: "Product analytics for retailers", headings: ["Pricing"], excerpt: "..." },
  };

  it("has a version and includes the rubric, lead and enrichment as delimited data", () => {
    expect(SCORE_PROMPT_VERSION).toMatch(/^score\/v\d+$/);
    const prompt = buildScorePrompt(input);
    expect(prompt).toContain(input.rubric);
    expect(prompt).toContain("maya@gmail.com");
    expect(prompt).toContain("Free-mail address: yes");
    expect(prompt).toContain("budget: 10-25k");
    expect(prompt).toContain("Product analytics for retailers");
    expect(prompt).toMatch(/<lead_message>[\s\S]*Need help with onboarding[\s\S]*<\/lead_message>/);
  });

  it("says when there is no enrichment", () => {
    expect(buildScorePrompt({ ...input, enrichment: null })).toContain("No website information");
  });

  it("calls the model with the score schema and applies deterministic adjustments", async () => {
    generate.mockResolvedValueOnce({
      object: { score: 75, fit: "high", reasons: ["SaaS"], summary: "Good fit.", confidence: 0.9 },
      meta: META,
    });
    const result = await scoreLead(input);
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({ name: "lead_scorer", promptVersion: SCORE_PROMPT_VERSION, schema: ScoreOutputSchema }),
    );
    expect(result.output.score).toBe(75);
    expect(result.adjusted.score).toBe(55); // gmail -10, message under 10 words -10
    expect(result.meta).toBe(META);
  });
});

describe("reply prompt", () => {
  const input: ReplyInput = {
    businessName: "Brightpath Studio",
    signature: "Sam Rivera, Brightpath Studio",
    toneNotes: "warm, direct",
    offer: "A 20-minute intro call to scope your onboarding project.",
    bookingUrl: BOOKING_URL,
    slots: SLOTS,
    lead: { name: "Maya Patel", company: "Northwind Analytics", message: "Need help with onboarding." },
    enrichmentSummary: "Product analytics SaaS, ~40 staff, London.",
    scoreReasons: ["B2B SaaS", "UK"],
  };

  it("lists the three slots and the booking URL and requires them verbatim", () => {
    const prompt = buildReplyPrompt(input);
    for (const slot of SLOTS) expect(prompt).toContain(`- ${slot}`);
    expect(prompt).toContain(BOOKING_URL);
    expect(prompt).toContain("First name: Maya");
    expect(prompt).toContain("Sam Rivera, Brightpath Studio");
    expect(REPLY_INSTRUCTIONS).toMatch(/verbatim/i);
    expect(REPLY_INSTRUCTIONS).toMatch(/booking link/i);
    expect(REPLY_INSTRUCTIONS).toMatch(/60.{1,4}180 words/);
    expect(REPLY_INSTRUCTIONS).toMatch(/pric/i);
  });

  it("frames a counter-proposal differently", () => {
    expect(buildReplyPrompt({ ...input, kind: "counter", slots: SLOTS.slice(0, 2) })).toMatch(/not available/i);
  });

  it("validates the draft and zeroes confidence when a slot is dropped", async () => {
    const body = [
      "Hi Maya,",
      "",
      "Thanks for getting in touch about onboarding at Northwind. A 20-minute intro call is the quickest way to see whether we can help before your Q1 launch, and to share how we have approached similar projects.",
      "",
      `- ${SLOTS[0]}`,
      `- ${SLOTS[1]}`,
      "",
      `Reply with the one that suits you, or choose another time here: ${BOOKING_URL}`,
      "",
      "Best,",
      "Sam Rivera, Brightpath Studio",
    ].join("\n");
    generate.mockResolvedValueOnce({
      object: { subject: "Intro call", body, confidence: 0.9, rationale: "r" },
      meta: META,
    });
    const result = await draftReply(input);
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({ name: "reply_writer", promptVersion: REPLY_PROMPT_VERSION, schema: ReplyDraftSchema }),
    );
    expect(result.validation.violations.map((v) => v.code)).toEqual(["missing_slot"]);
    expect(result.draft.confidence).toBe(0);
  });

  describe("decline", () => {
    const decline: DeclineInput = {
      businessName: "Brightpath Studio",
      signature: "Sam Rivera, Brightpath Studio",
      lead: { name: "Jordan", message: "Need a cheap restaurant website." },
      reason: "Outside our focus (B2B software).",
      resourceUrl: "https://example.org/guide",
    };

    it("is short, kind, has no slots and offers one resource", () => {
      const prompt = buildDeclinePrompt(decline);
      expect(DECLINE_PROMPT_VERSION).toMatch(/^decline\/v\d+$/);
      expect(prompt).toContain("https://example.org/guide");
      expect(prompt).not.toContain(BOOKING_URL);
      expect(DECLINE_INSTRUCTIONS).toMatch(/kind/i);
      expect(DECLINE_INSTRUCTIONS).toMatch(/120 words/);
      expect(DECLINE_INSTRUCTIONS).toMatch(/no meeting times/i);
    });

    it("validates with the decline guardrail", async () => {
      generate.mockResolvedValueOnce({
        object: {
          subject: "Thanks for reaching out",
          body: "Hi Jordan,\n\nThank you for writing. We only build software for B2B teams, so we are not the right fit. This guide may help: https://example.org/guide\n\nBest wishes,\nSam Rivera, Brightpath Studio",
          confidence: 0.85,
          rationale: "Low fit.",
        },
        meta: META,
      });
      const result = await draftDecline(decline);
      expect(result.validation.ok).toBe(true);
      expect(result.draft.confidence).toBe(0.85);
      expect(generate).toHaveBeenCalledWith(expect.objectContaining({ promptVersion: DECLINE_PROMPT_VERSION }));
    });
  });
});

describe("classify prompt", () => {
  const input: ClassifyInput = {
    replyText: "Thursday at 3 works better for me.\n\nOn Mon, 5 Oct 2026 at 09:01, Sam wrote:\n> - " + SLOTS[0],
    subject: "Re: Intro call",
    receivedAt: new Date("2026-10-06T13:05:00Z"),
    timezone: "Europe/London",
    offeredSlots: SLOTS,
  };

  it("anchors relative times to the received timestamp in the lead's zone", () => {
    const prompt = buildClassifyPrompt(input);
    expect(prompt).toContain("Tue 6 Oct 2026, 14:05 (Europe/London)");
    expect(prompt).toContain("2026-10-06T13:05:00.000Z");
    expect(CLASSIFY_INSTRUCTIONS).toMatch(/relative/i);
    expect(CLASSIFY_INSTRUCTIONS).toMatch(/YYYY-MM-DDTHH:mm/);
  });

  it("labels the offered slots with 0-based indexes and strips the quoted thread", () => {
    const prompt = buildClassifyPrompt(input);
    SLOTS.forEach((slot, i) => expect(prompt).toContain(`[${i}] ${slot}`));
    expect(prompt).toMatch(/<reply>\s*Thursday at 3 works better for me.\s*<\/reply>/);
  });

  it("calls the model deterministically with the classification schema", async () => {
    const object = {
      intent: "proposes_time",
      acceptedSlotIndex: null,
      proposedStart: "2026-10-08T15:00",
      proposedTimezone: "Europe/London",
      returnDate: null,
      summary: "Proposes Thursday 15:00.",
      suggestedAction: "Check availability.",
      confidence: 0.82,
    } as const;
    generate.mockResolvedValueOnce({ object, meta: META });
    const result = await classifyReply(input);
    expect(result.classification).toEqual(object);
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "reply_classifier",
        promptVersion: CLASSIFY_PROMPT_VERSION,
        schema: ReplyClassificationSchema,
        temperature: 0,
      }),
    );
  });
});

describe("simulate-lead-reply prompt (demo)", () => {
  it.each(REPLY_INTENTS)("builds a prompt for %s", (intent) => {
    const prompt = buildSimulatePrompt({
      intent,
      leadName: "Maya Patel",
      company: "Northwind Analytics",
      ourSubject: "Intro call",
      ourBody: "Hi Maya, here are three times...",
      offeredSlots: SLOTS,
      leadTimezone: "Europe/London",
      now: new Date("2026-10-05T12:00:00Z"),
    });
    expect(prompt).toContain(intent);
    expect(prompt).toContain("Maya Patel");
    expect(prompt).toContain("Mon 5 Oct 2026");
  });

  it("returns subject and body with a version", async () => {
    expect(SIMULATE_PROMPT_VERSION).toMatch(/^simulate-lead-reply\/v\d+$/);
    generate.mockResolvedValueOnce({ object: { subject: "Re: Intro call", body: "Tuesday works!" }, meta: META });
    const result = await simulateLeadReply({
      intent: "accepts_slot",
      ourSubject: "Intro call",
      ourBody: "...",
      offeredSlots: SLOTS,
      now: new Date("2026-10-05T12:00:00Z"),
    });
    expect(result.reply).toEqual({ subject: "Re: Intro call", body: "Tuesday works!" });
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({ schema: SimulatedReplySchema }));
  });
});
