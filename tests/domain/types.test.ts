import { describe, expect, it } from "vitest";
import {
  AvailabilityRuleSchema,
  BusySchema,
  DEFAULT_SLOT_POLICY,
  FITS,
  LeadInputSchema,
  REPLY_INTENTS,
  ReplyClassificationSchema,
  ReplyDraftSchema,
  ScoreOutputSchema,
  SlotPolicySchema,
  SlotSchema,
  type ReplyClassification,
} from "@/lib/domain/types";

describe("LeadInputSchema", () => {
  const lead = {
    name: "Maya Patel",
    email: "maya@northwind.example",
    company: "Northwind Analytics",
    message: "We need help rebuilding our onboarding flow before Q1.",
    source: "form",
  };

  it("accepts a minimal lead (email, message, source)", () => {
    expect(LeadInputSchema.parse({ email: "a@b.co", message: "", source: "webhook" })).toEqual({
      email: "a@b.co",
      message: "",
      source: "webhook",
    });
  });

  it("accepts the full shape with custom fields and a lead time zone", () => {
    const full = { ...lead, customFields: { budget: "10-20k" }, leadTimezone: "Europe/London" };
    expect(LeadInputSchema.parse(full)).toEqual(full);
  });

  it("trims and lower-cases the email", () => {
    expect(LeadInputSchema.parse({ ...lead, email: "  Maya@Northwind.Example " }).email).toBe(
      "maya@northwind.example",
    );
  });

  it.each(["not-an-email", "", "maya@"])("rejects email %j", (email) => {
    expect(LeadInputSchema.safeParse({ ...lead, email }).success).toBe(false);
  });

  it("rejects an unknown source", () => {
    expect(LeadInputSchema.safeParse({ ...lead, source: "carrier-pigeon" }).success).toBe(false);
  });

  it("rejects an unknown IANA time zone", () => {
    expect(LeadInputSchema.safeParse({ ...lead, leadTimezone: "Mars/Olympus" }).success).toBe(false);
  });
});

describe("ScoreOutputSchema", () => {
  const ok = { score: 72, fit: "high", reasons: ["B2B SaaS, 40 staff"], summary: "Good fit.", confidence: 0.85 };

  it("accepts a valid model output", () => {
    expect(ScoreOutputSchema.parse(ok)).toEqual(ok);
  });

  it("exposes the four fit bands in order", () => {
    expect(FITS).toEqual(["spam", "low", "medium", "high"]);
  });

  it.each([
    { score: -1 },
    { score: 101 },
    { score: 50.5 },
    { fit: "great" },
    { confidence: 1.2 },
    { confidence: -0.1 },
  ])("rejects %j", (patch) => {
    expect(ScoreOutputSchema.safeParse({ ...ok, ...patch }).success).toBe(false);
  });
});

describe("ReplyDraftSchema", () => {
  it("requires subject, body, confidence and rationale", () => {
    expect(ReplyDraftSchema.safeParse({ subject: "Hi", body: "x", confidence: 0.5, rationale: "r" }).success).toBe(
      true,
    );
    expect(ReplyDraftSchema.safeParse({ subject: "", body: "x", confidence: 0.5, rationale: "r" }).success).toBe(
      false,
    );
    expect(ReplyDraftSchema.safeParse({ subject: "Hi", body: "x", rationale: "r" }).success).toBe(false);
  });
});

describe("ReplyClassificationSchema", () => {
  const base: ReplyClassification = {
    intent: "accepts_slot",
    acceptedSlotIndex: 1,
    proposedStart: null,
    proposedTimezone: null,
    returnDate: null,
    summary: "Takes the second slot.",
    suggestedAction: "Book slot 1.",
    confidence: 0.92,
  };

  it("lists the six intents", () => {
    expect(REPLY_INTENTS).toEqual([
      "accepts_slot",
      "proposes_time",
      "asks_question",
      "not_interested",
      "out_of_office",
      "other",
    ]);
  });

  it("accepts a classification with nulls for unused fields", () => {
    expect(ReplyClassificationSchema.parse(base)).toEqual(base);
  });

  it.each(["2026-10-08T15:00", "2026-10-08T15:00:00", "2026-10-08T15:00:00Z", "2026-10-08T15:00:00+01:00"])(
    "accepts proposedStart %j (local or with offset)",
    (proposedStart) => {
      expect(
        ReplyClassificationSchema.safeParse({ ...base, intent: "proposes_time", proposedStart }).success,
      ).toBe(true);
    },
  );

  it.each(["next Tuesday", "2026-10-08", "2026-13-08T15:00"])("rejects proposedStart %j", (proposedStart) => {
    expect(ReplyClassificationSchema.safeParse({ ...base, proposedStart }).success).toBe(false);
  });

  it("validates returnDate as an ISO date", () => {
    expect(ReplyClassificationSchema.safeParse({ ...base, returnDate: "2026-10-13" }).success).toBe(true);
    expect(ReplyClassificationSchema.safeParse({ ...base, returnDate: "13/10/2026" }).success).toBe(false);
  });

  it("rejects a fractional or negative slot index", () => {
    expect(ReplyClassificationSchema.safeParse({ ...base, acceptedSlotIndex: 1.5 }).success).toBe(false);
    expect(ReplyClassificationSchema.safeParse({ ...base, acceptedSlotIndex: -1 }).success).toBe(false);
  });
});

describe("AvailabilityRuleSchema", () => {
  it("accepts Monday 09:00-17:00", () => {
    expect(AvailabilityRuleSchema.parse({ weekday: 1, startMinute: 540, endMinute: 1020 })).toEqual({
      weekday: 1,
      startMinute: 540,
      endMinute: 1020,
    });
  });

  it.each([
    { weekday: 0, startMinute: 540, endMinute: 1020 },
    { weekday: 8, startMinute: 540, endMinute: 1020 },
    { weekday: 1, startMinute: 600, endMinute: 600 },
    { weekday: 1, startMinute: 700, endMinute: 600 },
    { weekday: 1, startMinute: -1, endMinute: 600 },
    { weekday: 1, startMinute: 0, endMinute: 1441 },
  ])("rejects %j", (rule) => {
    expect(AvailabilityRuleSchema.safeParse(rule).success).toBe(false);
  });
});

describe("SlotPolicySchema", () => {
  it("fills spec defaults (30 min, 4 h notice, 10 business days)", () => {
    expect(SlotPolicySchema.parse({ timezone: "America/New_York" })).toEqual({
      ...DEFAULT_SLOT_POLICY,
      timezone: "America/New_York",
    });
    expect(DEFAULT_SLOT_POLICY).toMatchObject({
      meetingMinutes: 30,
      bufferMinutes: 0,
      minNoticeHours: 4,
      horizonBusinessDays: 10,
      blackoutDates: [],
    });
  });

  it.each([{ meetingMinutes: 20 }, { bufferMinutes: -5 }, { horizonBusinessDays: 0 }, { blackoutDates: ["2026-02-30"] }])(
    "rejects %j",
    (patch) => {
      expect(SlotPolicySchema.safeParse({ timezone: "America/New_York", ...patch }).success).toBe(false);
    },
  );

  it("rejects an unknown time zone", () => {
    expect(SlotPolicySchema.safeParse({ timezone: "Nowhere/City" }).success).toBe(false);
  });
});

describe("SlotSchema / BusySchema", () => {
  const start = new Date("2026-10-06T14:00:00Z");
  const end = new Date("2026-10-06T14:30:00Z");

  it("accepts a range that ends after it starts", () => {
    expect(SlotSchema.parse({ start, end })).toEqual({ start, end });
    expect(BusySchema.parse({ start, end })).toEqual({ start, end });
  });

  it("rejects an empty or inverted range", () => {
    expect(SlotSchema.safeParse({ start, end: start }).success).toBe(false);
    expect(BusySchema.safeParse({ start: end, end: start }).success).toBe(false);
  });
});
