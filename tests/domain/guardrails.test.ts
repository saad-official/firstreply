import { describe, expect, it } from "vitest";
import {
  DECLINE_MAX_WORDS,
  firstNameOf,
  REPLY_MAX_WORDS,
  REPLY_MIN_WORDS,
  validateDeclineDraft,
  validateReplyDraft,
  type DeclineDraftContext,
  type ReplyDraftContext,
} from "@/lib/domain/guardrails";
import { wordCount } from "@/lib/domain/scoring";
import type { ReplyDraft } from "@/lib/domain/types";

const SLOTS = [
  "Tue 6 Oct, 10:30–11:00 (Europe/London)",
  "Wed 7 Oct, 14:00–14:30 (Europe/London)",
  "Thu 8 Oct, 10:00–10:30 (Europe/London)",
];
const BOOKING_URL = "https://firstreply.app/b/brightpath";
const SIGNATURE = "Sam Rivera, Brightpath Studio";

const ctx: ReplyDraftContext = {
  slots: SLOTS,
  bookingUrl: BOOKING_URL,
  firstName: "Maya",
  signature: SIGNATURE,
  offer: "A 20-minute intro call to scope your onboarding project.",
};

const GOOD_BODY = [
  "Hi Maya,",
  "",
  "Thanks for reaching out about rebuilding the onboarding flow at Northwind before your Q1 launch. That is exactly the kind of project we help B2B SaaS teams with, and a 20-minute intro call is the quickest way to see whether we are a good fit.",
  "",
  "Here are three times that work on our side:",
  `- ${SLOTS[0]}`,
  `- ${SLOTS[1]}`,
  `- ${SLOTS[2]}`,
  "",
  `Just reply with the one that suits you, or pick another time here: ${BOOKING_URL}`,
  "",
  "Best,",
  SIGNATURE,
].join("\n");

function draft(overrides: Partial<ReplyDraft> = {}): ReplyDraft {
  return {
    subject: "Quick intro call about your onboarding project",
    body: GOOD_BODY,
    confidence: 0.9,
    rationale: "Medium-high fit; offers three slots.",
    ...overrides,
  };
}

const codes = (d: ReplyDraft, c: ReplyDraftContext = ctx) => validateReplyDraft(d, c).violations.map((v) => v.code);

describe("validateReplyDraft", () => {
  it("passes a clean reply and keeps its confidence", () => {
    expect(wordCount(GOOD_BODY)).toBeGreaterThanOrEqual(REPLY_MIN_WORDS);
    expect(validateReplyDraft(draft(), ctx)).toEqual({ ok: true, violations: [], adjustedConfidence: 0.9 });
  });

  it("forces confidence to 0 on any violation and clamps otherwise", () => {
    expect(validateReplyDraft(draft({ body: GOOD_BODY.replace(SLOTS[0], "") }), ctx).adjustedConfidence).toBe(0);
    expect(validateReplyDraft(draft({ confidence: 1.4 }), ctx).adjustedConfidence).toBe(1);
    expect(validateReplyDraft(draft({ confidence: Number.NaN }), ctx).adjustedConfidence).toBe(0);
  });

  describe("slots", () => {
    it("flags each missing slot", () => {
      const body = GOOD_BODY.replace(`- ${SLOTS[1]}\n`, "").replace(SLOTS[2], "Thursday morning");
      const result = validateReplyDraft(draft({ body }), ctx);
      expect(result.violations.filter((v) => v.code === "missing_slot").map((v) => v.message)).toEqual([
        `Body must include the slot "${SLOTS[1]}" verbatim.`,
        `Body must include the slot "${SLOTS[2]}" verbatim.`,
      ]);
    });

    it("rejects a reworded slot (12-hour clock)", () => {
      const body = GOOD_BODY.replace(SLOTS[0], "Tue 6 Oct, 10:30am–11:00am (Europe/London)");
      expect(codes(draft({ body }))).toEqual(["missing_slot"]);
    });

    it("tolerates a plain hyphen for the en dash and extra spaces", () => {
      const body = GOOD_BODY.replace(SLOTS[0], "Tue 6 Oct,  10:30-11:00 (Europe/London)");
      expect(codes(draft({ body }))).toEqual([]);
    });
  });

  describe("booking link", () => {
    it("requires the booking URL", () => {
      const body = GOOD_BODY.replace(`, or pick another time here: ${BOOKING_URL}`, ".");
      expect(codes(draft({ body }))).toEqual(["missing_booking_url"]);
    });

    it("accepts the URL with or without a trailing slash", () => {
      expect(codes(draft({ body: GOOD_BODY.replace(BOOKING_URL, `${BOOKING_URL}/`) }))).toEqual([]);
      expect(codes(draft(), { ...ctx, bookingUrl: `${BOOKING_URL}/` })).toEqual([]);
    });

    it("rejects a different booking URL", () => {
      const body = GOOD_BODY.replace(BOOKING_URL, "https://calendly.com/someone-else");
      expect(codes(draft({ body }))).toEqual(["missing_booking_url"]);
    });
  });

  describe("first name", () => {
    it("requires the first name in the greeting when known", () => {
      expect(codes(draft({ body: GOOD_BODY.replace("Hi Maya,", "Hi there,") }))).toEqual(["missing_first_name"]);
    });

    it("is case-insensitive and skipped when the name is unknown", () => {
      expect(codes(draft(), { ...ctx, firstName: "maya" })).toEqual([]);
      expect(codes(draft({ body: GOOD_BODY.replace("Hi Maya,", "Hi there,") }), { ...ctx, firstName: undefined })).toEqual(
        [],
      );
    });

    it("does not accept the name only as part of another word", () => {
      expect(codes(draft({ body: GOOD_BODY.replace("Hi Maya,", "Hi Mayank,") }))).toEqual(["missing_first_name"]);
    });
  });

  describe("placeholders", () => {
    it.each(["[First Name]", "{{first_name}}", "{company}", "<<NAME>>", "TBD"])("flags %j", (placeholder) => {
      const body = GOOD_BODY.replace("at Northwind", `at ${placeholder}`);
      expect(codes(draft({ body }))).toContain("placeholder");
    });

    it("flags placeholders in the subject", () => {
      expect(codes(draft({ subject: "Intro call for [Company]" }))).toEqual(["placeholder"]);
    });
  });

  describe("pricing", () => {
    it.each([
      "It usually costs $2,000.",
      "Our pricing starts low.",
      "I can send a quote after the call.",
      "We offer a launch discount.",
      "Expect 20% off this month.",
      "Our day rate is reasonable.",
      "The fee is fixed.",
      "That would be £500.",
    ])("flags %j", (sentence) => {
      const body = GOOD_BODY.replace("That is exactly", `${sentence} That is exactly`);
      expect(codes(draft({ body }))).toEqual(["pricing"]);
    });

    it("allows a pricing term that appears in the owner's offer text", () => {
      const offer = "A free 20-minute call, and a written quote within two days.";
      const body = GOOD_BODY.replace("That is exactly", "We can follow up with a written quote. That is exactly");
      expect(codes(draft({ body }), { ...ctx, offer })).toEqual([]);
      // ...but only that term.
      const withPrice = body.replace("written quote", "written quote at $900");
      expect(codes(draft({ body: withPrice }), { ...ctx, offer })).toEqual(["pricing"]);
    });

    it("ignores pricing words inside the booking URL and signature", () => {
      const c = { ...ctx, bookingUrl: "https://firstreply.app/b/price-partners", signature: "Sam, Price & Co" };
      const body = GOOD_BODY.replaceAll(BOOKING_URL, c.bookingUrl).replace(SIGNATURE, c.signature);
      expect(codes(draft({ body }), c)).toEqual([]);
    });
  });

  describe("length", () => {
    it(`requires ${REPLY_MIN_WORDS}-${REPLY_MAX_WORDS} words`, () => {
      const short = ["Hi Maya,", ...SLOTS, BOOKING_URL, "Best,", SIGNATURE].join("\n");
      expect(codes(draft({ body: short }))).toEqual(["word_count"]);
      const padding = Array.from({ length: 20 }, () => "We look forward to hearing about your plans.").join(" ");
      const long = GOOD_BODY.replace("Here are three", `${padding}\n\nHere are three`);
      expect(wordCount(long)).toBeGreaterThan(REPLY_MAX_WORDS);
      expect(codes(draft({ body: long }))).toEqual(["word_count"]);
    });
  });

  describe("sign-off", () => {
    it("accepts the signature or a closing line", () => {
      expect(codes(draft({ body: GOOD_BODY.replace("Best,\n", "") }))).toEqual([]);
      expect(codes(draft({ body: GOOD_BODY.replace(SIGNATURE, "Sam") }))).toEqual([]);
    });

    it("flags a body with neither", () => {
      const body = GOOD_BODY.replace("\n\nBest,\n" + SIGNATURE, "");
      expect(codes(draft({ body }))).toEqual(["missing_sign_off"]);
    });
  });
});

describe("validateDeclineDraft", () => {
  const declineCtx: DeclineDraftContext = { slots: SLOTS, bookingUrl: BOOKING_URL, signature: SIGNATURE, offer: ctx.offer };
  const DECLINE_BODY = [
    "Hi Jordan,",
    "",
    "Thank you for thinking of us. We focus on onboarding for B2B software teams, so we are not the right partner for a restaurant website.",
    "",
    "The Small Business Web Guide at https://example.org/guide is a good place to start, and it lists studios that specialise in hospitality.",
    "",
    "Wishing you the best with the project,",
    SIGNATURE,
  ].join("\n");
  const decline = (overrides: Partial<ReplyDraft> = {}): ReplyDraft => ({
    subject: "Thanks for getting in touch",
    body: DECLINE_BODY,
    confidence: 0.8,
    rationale: "Low fit: outside our niche.",
    ...overrides,
  });
  const declineCodes = (d: ReplyDraft, c: DeclineDraftContext = declineCtx) =>
    validateDeclineDraft(d, c).violations.map((v) => v.code);

  it("passes a short, kind decline", () => {
    expect(validateDeclineDraft(decline(), declineCtx)).toEqual({ ok: true, violations: [], adjustedConfidence: 0.8 });
  });

  it(`caps declines at ${DECLINE_MAX_WORDS} words`, () => {
    const padding = Array.from({ length: 12 }, () => "We really do appreciate you writing to us.").join(" ");
    const body = DECLINE_BODY.replace("The Small Business", `${padding} The Small Business`);
    expect(declineCodes(decline({ body }))).toEqual(["word_count"]);
  });

  it("must not offer slots or the booking link", () => {
    expect(declineCodes(decline({ body: DECLINE_BODY.replace("Wishing", `${SLOTS[0]} could work.\n\nWishing`) }))).toEqual([
      "offers_meeting",
    ]);
    expect(declineCodes(decline({ body: DECLINE_BODY.replace("Wishing", `Book here: ${BOOKING_URL}\n\nWishing`) }))).toEqual([
      "offers_meeting",
    ]);
    expect(declineCodes(decline({ body: DECLINE_BODY.replace("Wishing", "Are you free 14:00-14:30 on Friday?\n\nWishing") }))).toEqual([
      "offers_meeting",
    ]);
  });

  it("must not mention pricing", () => {
    expect(declineCodes(decline({ body: DECLINE_BODY.replace("Thank you", "Our prices start at $5k. Thank you") }))).toEqual([
      "pricing",
    ]);
  });

  it.each(["This looks like spam.", "Your budget is too small for us.", "This is not worth our time."])(
    "flags unkind wording %j",
    (sentence) => {
      expect(declineCodes(decline({ body: DECLINE_BODY.replace("Thank you", `${sentence} Thank you`) }))).toEqual([
        "unkind",
      ]);
    },
  );

  it("flags placeholders and a missing sign-off", () => {
    expect(declineCodes(decline({ body: DECLINE_BODY.replace("Jordan", "[Name]") }))).toEqual(["placeholder"]);
    const body = DECLINE_BODY.replace(`\n\nWishing you the best with the project,\n${SIGNATURE}`, "");
    expect(declineCodes(decline({ body }))).toEqual(["missing_sign_off"]);
  });

  it("works without slot or booking context", () => {
    expect(declineCodes(decline(), { signature: SIGNATURE })).toEqual([]);
  });
});

describe("firstNameOf", () => {
  it.each([
    ["Maya Patel", "Maya"],
    ["  maya  ", "Maya"],
    ["Dr. Ana Souza", "Ana"],
    ["Patel, Maya", "Maya"],
    ["JORDAN LEE", "Jordan"],
    ["Jean-Luc Picard", "Jean-Luc"],
  ])("%j -> %j", (name, first) => {
    expect(firstNameOf(name)).toBe(first);
  });

  it.each([undefined, "", "   ", "info", "Sales Team", "x"])("returns undefined for %j", (name) => {
    expect(firstNameOf(name)).toBeUndefined();
  });
});
