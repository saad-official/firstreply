import { describe, expect, it } from "vitest";
import {
  COUNTER_SLOT_COUNT,
  handleReply,
  isWithinAvailability,
  MIN_CLASSIFICATION_CONFIDENCE,
  parseProposedStart,
  stripQuotedReply,
  type NegotiationContext,
} from "@/lib/domain/negotiation";
import { suggestSlots } from "@/lib/domain/slots";
import type { AvailabilityRule, Busy, ReplyClassification, SlotPolicy } from "@/lib/domain/types";

const NY = "America/New_York";
const LONDON = "Europe/London";
const RULES: AvailabilityRule[] = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startMinute: 540, endMinute: 1020 }));
const POLICY: SlotPolicy = {
  timezone: NY,
  meetingMinutes: 30,
  bufferMinutes: 0,
  minNoticeHours: 4,
  horizonBusinessDays: 10,
  blackoutDates: ["2026-10-08"],
};
const at = (v: string) => new Date(v);
const range = (start: string, end: string): Busy => ({ start: at(start), end: at(end) });

// Monday 2026-10-05 08:00 EDT. The first reply offered Mon 12:00, Tue 09:00 and Wed 12:00 EDT.
const NOW = at("2026-10-05T12:00:00Z");
const OFFERED = suggestSlots({ rules: RULES, busy: [], policy: POLICY, now: NOW });

function ctx(overrides: Partial<NegotiationContext> = {}): NegotiationContext {
  return { offeredSlots: OFFERED, policy: POLICY, rules: RULES, busy: [], now: NOW, ...overrides };
}

function classification(overrides: Partial<ReplyClassification> = {}): ReplyClassification {
  return {
    intent: "accepts_slot",
    acceptedSlotIndex: 1,
    proposedStart: null,
    proposedTimezone: null,
    returnDate: null,
    summary: "Lead picks Tuesday morning.",
    suggestedAction: "Book Tuesday 09:00.",
    confidence: 0.9,
    ...overrides,
  };
}

const propose = (proposedStart: string | null, proposedTimezone: string | null = null) =>
  classification({ intent: "proposes_time", acceptedSlotIndex: null, proposedStart, proposedTimezone });

it("offers the expected fixture slots", () => {
  expect(OFFERED.map((s) => s.start.toISOString())).toEqual([
    "2026-10-05T16:00:00.000Z",
    "2026-10-06T13:00:00.000Z",
    "2026-10-07T16:00:00.000Z",
  ]);
  expect(COUNTER_SLOT_COUNT).toBe(2);
  expect(MIN_CLASSIFICATION_CONFIDENCE).toBe(0.6);
});

describe("accepts_slot", () => {
  it("books the referenced slot when it is still free", () => {
    expect(handleReply(classification(), ctx())).toEqual({
      leadStatus: "booked",
      action: "book",
      bookSlot: OFFERED[1],
      tasks: ["Send the booking confirmation with a calendar invite."],
    });
  });

  it("counters with two alternatives when the slot was taken meanwhile", () => {
    const busy = [range("2026-10-06T13:00:00Z", "2026-10-06T13:30:00Z")];
    const outcome = handleReply(classification(), ctx({ busy }));
    expect(outcome.action).toBe("counter");
    expect(outcome.leadStatus).toBe("negotiating");
    expect(outcome.counterSlots).toEqual([
      range("2026-10-05T16:00:00Z", "2026-10-05T16:30:00Z"),
      range("2026-10-06T13:30:00Z", "2026-10-06T14:00:00Z"),
    ]);
    expect(outcome.tasks).toEqual(["The chosen slot is no longer free: approve a counter with 2 alternatives."]);
  });

  it("respects the buffer around new bookings when checking the slot", () => {
    const busy = [range("2026-10-06T12:15:00Z", "2026-10-06T12:50:00Z")];
    expect(handleReply(classification(), ctx({ busy, policy: { ...POLICY, bufferMinutes: 15 } })).action).toBe("counter");
    expect(handleReply(classification(), ctx({ busy, policy: { ...POLICY, bufferMinutes: 10 } })).action).toBe("book");
  });

  it("counters when the accepted slot is already in the past", () => {
    const outcome = handleReply(classification({ acceptedSlotIndex: 0 }), ctx({ now: at("2026-10-05T17:00:00Z") }));
    expect(outcome.action).toBe("counter");
    expect(outcome.counterSlots?.every((s) => s.start.getTime() > at("2026-10-05T17:00:00Z").getTime())).toBe(true);
  });

  it("books the only offered slot when the index is missing", () => {
    const outcome = handleReply(classification({ acceptedSlotIndex: null }), ctx({ offeredSlots: [OFFERED[2]] }));
    expect(outcome).toMatchObject({ action: "book", bookSlot: OFFERED[2] });
  });

  it.each([null, 3])("sends index %j to review when several slots were offered", (acceptedSlotIndex) => {
    expect(handleReply(classification({ acceptedSlotIndex }), ctx())).toEqual({
      action: "review",
      tasks: ["Review the reply: the lead accepted a slot but it is unclear which one."],
    });
  });

  it("sends to review when nothing is free to counter with", () => {
    const busy = [range("2026-10-01T00:00:00Z", "2026-12-31T00:00:00Z")];
    expect(handleReply(classification(), ctx({ busy }))).toEqual({
      action: "review",
      tasks: ["Review the reply: the chosen slot is taken and no alternatives are free in the horizon."],
    });
  });
});

describe("proposes_time", () => {
  it("parses the time in the lead's stated zone and books it when free", () => {
    // Wed 7 Oct 15:00 BST = 14:00Z = 10:00 EDT.
    expect(handleReply(propose("2026-10-07T15:00", LONDON), ctx())).toEqual({
      leadStatus: "booked",
      action: "book",
      bookSlot: range("2026-10-07T14:00:00Z", "2026-10-07T14:30:00Z"),
      tasks: ["Send the booking confirmation with a calendar invite."],
    });
  });

  it("falls back to the lead's known zone, then the org's zone", () => {
    expect(handleReply(propose("2026-10-07T15:00"), ctx({ leadTimezone: LONDON })).bookSlot).toEqual(
      range("2026-10-07T14:00:00Z", "2026-10-07T14:30:00Z"),
    );
    expect(handleReply(propose("2026-10-07T10:00"), ctx()).bookSlot).toEqual(
      range("2026-10-07T14:00:00Z", "2026-10-07T14:30:00Z"),
    );
    // An invalid zone from the model is ignored.
    expect(handleReply(propose("2026-10-07T10:00", "Somewhere/Else"), ctx()).bookSlot).toEqual(
      range("2026-10-07T14:00:00Z", "2026-10-07T14:30:00Z"),
    );
  });

  it("uses an explicit offset as an absolute instant", () => {
    expect(handleReply(propose("2026-10-07T14:00:00Z", LONDON), ctx()).bookSlot).toEqual(
      range("2026-10-07T14:00:00Z", "2026-10-07T14:30:00Z"),
    );
  });

  it("accepts a proposal off the 30-minute grid when it fits the rules", () => {
    expect(handleReply(propose("2026-10-07T10:15"), ctx()).bookSlot).toEqual(
      range("2026-10-07T14:15:00Z", "2026-10-07T14:45:00Z"),
    );
  });

  it("counters with the two free slots closest to an out-of-hours proposal", () => {
    // Wed 23:00 BST = 18:00 EDT, after hours. Closest: Wed 16:00 and 16:30 EDT.
    const outcome = handleReply(propose("2026-10-07T23:00", LONDON), ctx());
    expect(outcome).toEqual({
      leadStatus: "negotiating",
      action: "counter",
      counterSlots: [
        range("2026-10-07T20:00:00Z", "2026-10-07T20:30:00Z"),
        range("2026-10-07T20:30:00Z", "2026-10-07T21:00:00Z"),
      ],
      tasks: ["The proposed time is not available: approve a counter with 2 alternatives."],
    });
  });

  it.each([
    ["busy", "2026-10-07T10:00", { busy: [range("2026-10-07T13:45:00Z", "2026-10-07T14:15:00Z")] }],
    ["a weekend", "2026-10-10T10:00", {}],
    ["a blackout date", "2026-10-08T10:00", {}],
    ["inside the minimum notice", "2026-10-05T10:00", {}],
    ["running past the end of the day", "2026-10-07T16:45", {}],
  ] as const)("counters when the proposal is %s", (_label, start, overrides) => {
    expect(handleReply(propose(start), ctx(overrides)).action).toBe("counter");
  });

  it("sends an unparseable or missing time to review", () => {
    const review = {
      action: "review",
      tasks: ["Review the reply: the lead proposed a time that could not be read."],
    };
    expect(handleReply(propose(null), ctx())).toEqual(review);
    expect(handleReply(propose("2026-02-30T10:00"), ctx())).toEqual(review);
  });
});

describe("asks_question", () => {
  it("drafts an answer for approval", () => {
    expect(handleReply(classification({ intent: "asks_question", acceptedSlotIndex: null }), ctx())).toEqual({
      leadStatus: "negotiating",
      action: "draft_answer",
      tasks: ["Draft an answer to the lead's question for approval."],
    });
  });
});

describe("not_interested", () => {
  it("closes the lead as declined with the reason", () => {
    const outcome = handleReply(
      classification({ intent: "not_interested", acceptedSlotIndex: null, summary: "Went with another agency." }),
      ctx(),
    );
    expect(outcome).toEqual({
      leadStatus: "declined",
      action: "close",
      closeReason: "Went with another agency.",
      tasks: ["Close the lead: Went with another agency."],
    });
  });
});

describe("out_of_office", () => {
  const ooo = (returnDate: string | null) =>
    classification({ intent: "out_of_office", acceptedSlotIndex: null, returnDate });

  it("follows up the day after the return date at the start of the org's day", () => {
    expect(handleReply(ooo("2026-10-13"), ctx())).toEqual({
      action: "follow_up_later",
      followUpAt: at("2026-10-14T13:00:00Z"), // Wed 09:00 EDT
      tasks: ["Follow up on 2026-10-14 (lead is out of office until 2026-10-13)."],
    });
  });

  it("follows up in 7 days when no return date is given", () => {
    expect(handleReply(ooo(null), ctx()).followUpAt).toEqual(at("2026-10-12T13:00:00Z"));
  });

  it("moves a weekend or blackout follow-up to the next working day", () => {
    // Fri 9 Oct + 1 = Sat 10 -> Mon 12.
    expect(handleReply(ooo("2026-10-09"), ctx()).followUpAt).toEqual(at("2026-10-12T13:00:00Z"));
    // Wed 7 Oct + 1 = Thu 8 (blackout) -> Fri 9.
    expect(handleReply(ooo("2026-10-07"), ctx()).followUpAt).toEqual(at("2026-10-09T13:00:00Z"));
  });

  it("never schedules a follow-up in the past", () => {
    expect(handleReply(ooo("2026-09-20"), ctx()).followUpAt).toEqual(at("2026-10-06T13:00:00Z"));
  });

  it("uses the org's local start of day across the DST change", () => {
    const outcome = handleReply(ooo("2026-11-01"), ctx({ now: at("2026-10-30T12:00:00Z") }));
    expect(outcome.followUpAt).toEqual(at("2026-11-02T14:00:00Z")); // Mon 09:00 EST
  });
});

describe("review", () => {
  it("sends 'other' to review", () => {
    expect(handleReply(classification({ intent: "other", summary: "Asks to be added to a newsletter." }), ctx())).toEqual({
      action: "review",
      tasks: ["Review the reply: Asks to be added to a newsletter."],
    });
  });

  it("sends any intent below 0.6 confidence to review", () => {
    expect(handleReply(classification({ confidence: 0.59 }), ctx())).toEqual({
      action: "review",
      tasks: ["Review the reply: low classification confidence (0.59)."],
    });
    expect(handleReply(classification({ intent: "not_interested", confidence: 0.4 }), ctx()).action).toBe("review");
    expect(handleReply(classification({ confidence: 0.6 }), ctx()).action).toBe("book");
  });
});

describe("parseProposedStart", () => {
  it("reads wall-clock times in the given zone, DST-aware", () => {
    expect(parseProposedStart("2026-10-23T15:00", LONDON)?.toISOString()).toBe("2026-10-23T14:00:00.000Z");
    expect(parseProposedStart("2026-10-26T15:00", LONDON)?.toISOString()).toBe("2026-10-26T15:00:00.000Z");
  });

  it("honours explicit offsets and rejects garbage", () => {
    expect(parseProposedStart("2026-10-26T15:00:00+02:00", LONDON)?.toISOString()).toBe("2026-10-26T13:00:00.000Z");
    expect(parseProposedStart("tomorrow at 3", LONDON)).toBeNull();
    expect(parseProposedStart("2026-10-26T25:00", LONDON)).toBeNull();
  });
});

describe("isWithinAvailability", () => {
  it("checks weekday, window and blackout in the org zone", () => {
    expect(isWithinAvailability(range("2026-10-07T13:00:00Z", "2026-10-07T13:30:00Z"), RULES, POLICY)).toBe(true);
    expect(isWithinAvailability(range("2026-10-07T12:30:00Z", "2026-10-07T13:00:00Z"), RULES, POLICY)).toBe(false);
    expect(isWithinAvailability(range("2026-10-08T13:00:00Z", "2026-10-08T13:30:00Z"), RULES, POLICY)).toBe(false);
    expect(isWithinAvailability(range("2026-10-10T13:00:00Z", "2026-10-10T13:30:00Z"), RULES, POLICY)).toBe(false);
  });
});

describe("stripQuotedReply", () => {
  it("drops the quoted thread below an 'On ... wrote:' line", () => {
    const text = [
      "Thursday works, the second one please.",
      "",
      "On Mon, 5 Oct 2026 at 09:01, Sam Rivera <sam@brightpath.example> wrote:",
      "> Hi Maya,",
      "> - Tue 6 Oct, 10:30–11:00 (Europe/London)",
    ].join("\n");
    expect(stripQuotedReply(text)).toBe("Thursday works, the second one please.");
  });

  it("drops '>' quoted lines and Outlook-style original-message blocks", () => {
    expect(stripQuotedReply("Sounds good.\n> quoted\n> more")).toBe("Sounds good.");
    expect(stripQuotedReply("Not for us, thanks.\n\n-----Original Message-----\nFrom: Sam")).toBe("Not for us, thanks.");
    expect(stripQuotedReply("Yes.\n\nFrom: Sam Rivera <sam@brightpath.example>\nSent: Monday")).toBe("Yes.");
  });

  it("keeps a reply with no quote untouched (trimmed)", () => {
    expect(stripQuotedReply("  Can we do Friday 3pm instead?  ")).toBe("Can we do Friday 3pm instead?");
  });
});
