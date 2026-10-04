import { describe, expect, it } from "vitest";
import { formatInstantFor, formatSlotFor, isSlotFree, listFreeSlots, suggestSlots } from "@/lib/domain/slots";
import type { AvailabilityRule, Busy, Slot, SlotPolicy } from "@/lib/domain/types";

const NY = "America/New_York";
const LONDON = "Europe/London";

/** Mon-Fri 09:00-17:00. */
const WEEKDAYS_9_TO_5: AvailabilityRule[] = [1, 2, 3, 4, 5].map((weekday) => ({
  weekday,
  startMinute: 9 * 60,
  endMinute: 17 * 60,
}));

function policy(overrides: Partial<SlotPolicy> = {}): SlotPolicy {
  return {
    timezone: NY,
    meetingMinutes: 30,
    bufferMinutes: 0,
    minNoticeHours: 4,
    horizonBusinessDays: 10,
    blackoutDates: [],
    ...overrides,
  };
}

const iso = (slots: Slot[]) => slots.map((s) => s.start.toISOString());
const at = (value: string) => new Date(value);
const range = (start: string, end: string): Busy => ({ start: at(start), end: at(end) });

describe("isSlotFree", () => {
  const slot = range("2026-10-05T16:00:00Z", "2026-10-05T16:30:00Z");

  it("is free with no busy ranges", () => {
    expect(isSlotFree(slot, [], 0)).toBe(true);
  });

  it("is not free when a busy range overlaps", () => {
    expect(isSlotFree(slot, [range("2026-10-05T16:15:00Z", "2026-10-05T17:00:00Z")], 0)).toBe(false);
    expect(isSlotFree(slot, [range("2026-10-05T15:00:00Z", "2026-10-05T18:00:00Z")], 0)).toBe(false);
  });

  it("treats back-to-back ranges as free without a buffer", () => {
    expect(isSlotFree(slot, [range("2026-10-05T15:30:00Z", "2026-10-05T16:00:00Z")], 0)).toBe(true);
    expect(isSlotFree(slot, [range("2026-10-05T16:30:00Z", "2026-10-05T17:00:00Z")], 0)).toBe(true);
  });

  it("pads busy ranges by the buffer on both sides", () => {
    const before = range("2026-10-05T15:30:00Z", "2026-10-05T15:50:00Z");
    expect(isSlotFree(slot, [before], 10)).toBe(true);
    expect(isSlotFree(slot, [before], 11)).toBe(false);
    const after = range("2026-10-05T16:40:00Z", "2026-10-05T17:00:00Z");
    expect(isSlotFree(slot, [after], 10)).toBe(true);
    expect(isSlotFree(slot, [after], 15)).toBe(false);
  });
});

describe("listFreeSlots", () => {
  // Monday 2026-10-05 05:00 in New York (EDT, UTC-4).
  const mondayEarly = at("2026-10-05T09:00:00Z");

  it("lists 30-minute-aligned slots inside the rules, grouped by org-local day", () => {
    const days = listFreeSlots({
      rules: [{ weekday: 1, startMinute: 9 * 60, endMinute: 11 * 60 }],
      busy: [],
      policy: policy({ horizonBusinessDays: 1 }),
      now: mondayEarly,
    });
    expect(days).toEqual([
      {
        date: "2026-10-05",
        slots: [
          range("2026-10-05T13:00:00Z", "2026-10-05T13:30:00Z"),
          range("2026-10-05T13:30:00Z", "2026-10-05T14:00:00Z"),
          range("2026-10-05T14:00:00Z", "2026-10-05T14:30:00Z"),
          range("2026-10-05T14:30:00Z", "2026-10-05T15:00:00Z"),
        ],
      },
    ]);
  });

  it("aligns starts to 30-minute boundaries when a rule starts off-boundary", () => {
    const [day] = listFreeSlots({
      rules: [{ weekday: 1, startMinute: 9 * 60 + 15, endMinute: 10 * 60 + 30 }],
      busy: [],
      policy: policy({ horizonBusinessDays: 1 }),
      now: mondayEarly,
    });
    expect(iso(day.slots)).toEqual(["2026-10-05T13:30:00.000Z", "2026-10-05T14:00:00.000Z"]);
  });

  it("only offers starts whose whole meeting fits in the rule (45-minute meetings)", () => {
    const [day] = listFreeSlots({
      rules: [{ weekday: 1, startMinute: 9 * 60, endMinute: 10 * 60 + 30 }],
      busy: [],
      policy: policy({ horizonBusinessDays: 1, meetingMinutes: 45 }),
      now: mondayEarly,
    });
    expect(day.slots).toEqual([
      range("2026-10-05T13:00:00Z", "2026-10-05T13:45:00Z"),
      range("2026-10-05T13:30:00Z", "2026-10-05T14:15:00Z"),
    ]);
  });

  it("supports several windows on one weekday (split shifts)", () => {
    const [day] = listFreeSlots({
      rules: [
        { weekday: 1, startMinute: 14 * 60, endMinute: 15 * 60 },
        { weekday: 1, startMinute: 9 * 60, endMinute: 10 * 60 },
      ],
      busy: [],
      policy: policy({ horizonBusinessDays: 1 }),
      now: mondayEarly,
    });
    expect(iso(day.slots)).toEqual([
      "2026-10-05T13:00:00.000Z",
      "2026-10-05T13:30:00.000Z",
      "2026-10-05T18:00:00.000Z",
      "2026-10-05T18:30:00.000Z",
    ]);
  });

  it("respects minimum notice, rounding up to the next boundary", () => {
    // 10:10 EDT + 4 h = 14:10 -> first start 14:30 EDT (18:30Z).
    const [day] = listFreeSlots({
      rules: WEEKDAYS_9_TO_5,
      busy: [],
      policy: policy({ horizonBusinessDays: 1 }),
      now: at("2026-10-05T14:10:00Z"),
    });
    expect(day.slots[0].start.toISOString()).toBe("2026-10-05T18:30:00.000Z");
    expect(day.slots.at(-1)?.start.toISOString()).toBe("2026-10-05T20:30:00.000Z");
  });

  it("skips slots that clash with busy ranges padded by the buffer", () => {
    const [day] = listFreeSlots({
      rules: [{ weekday: 1, startMinute: 10 * 60 + 30, endMinute: 14 * 60 }],
      // Existing meeting 12:00-13:00 EDT.
      busy: [range("2026-10-05T16:00:00Z", "2026-10-05T17:00:00Z")],
      policy: policy({ horizonBusinessDays: 1, bufferMinutes: 15 }),
      now: mondayEarly,
    });
    // 11:30 ends at 12:00 (inside the buffer), 13:00 starts at the end (inside the buffer).
    expect(iso(day.slots)).toEqual([
      "2026-10-05T14:30:00.000Z",
      "2026-10-05T15:00:00.000Z",
      "2026-10-05T17:30:00.000Z",
    ]);
  });

  it("skips weekends without rules and blackout dates, which do not use up the horizon", () => {
    const days = listFreeSlots({
      rules: WEEKDAYS_9_TO_5,
      busy: [],
      policy: policy({ horizonBusinessDays: 3, blackoutDates: ["2026-10-12"] }),
      // Friday 2026-10-09 18:00 EDT: nothing left today.
      now: at("2026-10-09T22:00:00Z"),
    });
    // Business days: Fri 9 (today, no slots left), Tue 13, Wed 14. Weekend has no rules; Mon 12 is blacked out.
    expect(days.map((d) => d.date)).toEqual(["2026-10-13", "2026-10-14"]);
  });

  it("counts today as the first business day of the horizon", () => {
    const days = listFreeSlots({
      rules: WEEKDAYS_9_TO_5,
      busy: [],
      policy: policy({ horizonBusinessDays: 2 }),
      now: at("2026-10-08T22:00:00Z"), // Thu 18:00 EDT
    });
    expect(days.map((d) => d.date)).toEqual(["2026-10-09"]);
  });

  it("stays on local wall-clock hours across the US DST change (EDT -> EST)", () => {
    const days = listFreeSlots({
      rules: [
        { weekday: 5, startMinute: 9 * 60, endMinute: 9 * 60 + 30 },
        { weekday: 1, startMinute: 9 * 60, endMinute: 9 * 60 + 30 },
      ],
      busy: [],
      policy: policy({ horizonBusinessDays: 2 }),
      now: at("2026-10-29T12:00:00Z"), // Thu 08:00 EDT
    });
    expect(days).toEqual([
      { date: "2026-10-30", slots: [range("2026-10-30T13:00:00Z", "2026-10-30T13:30:00Z")] },
      { date: "2026-11-02", slots: [range("2026-11-02T14:00:00Z", "2026-11-02T14:30:00Z")] },
    ]);
  });

  it("skips non-existent local times on a spring-forward day", () => {
    const [day] = listFreeSlots({
      rules: [{ weekday: 7, startMinute: 2 * 60, endMinute: 3 * 60 + 30 }],
      busy: [],
      policy: policy({ horizonBusinessDays: 1, minNoticeHours: 0 }),
      now: at("2026-03-08T05:00:00Z"), // Sun 00:00 EST
    });
    // 02:00 and 02:30 do not exist; 03:00 EDT = 07:00Z.
    expect(iso(day.slots)).toEqual(["2026-03-08T07:00:00.000Z"]);
  });

  it("handles a rule that runs to midnight", () => {
    const [day] = listFreeSlots({
      rules: [{ weekday: 1, startMinute: 23 * 60, endMinute: 24 * 60 }],
      busy: [],
      policy: policy({ horizonBusinessDays: 1, timezone: LONDON }),
      now: at("2026-10-05T08:00:00Z"),
    });
    expect(iso(day.slots)).toEqual(["2026-10-05T22:00:00.000Z", "2026-10-05T22:30:00.000Z"]);
  });

  it("returns nothing when there are no rules", () => {
    expect(listFreeSlots({ rules: [], busy: [], policy: policy(), now: mondayEarly })).toEqual([]);
  });
});

describe("suggestSlots", () => {
  it("picks the earliest slot, then one per day alternating afternoon/morning", () => {
    const slots = suggestSlots({
      rules: WEEKDAYS_9_TO_5,
      busy: [],
      policy: policy(),
      now: at("2026-10-05T12:00:00Z"), // Mon 08:00 EDT, 4 h notice -> 12:00
    });
    expect(slots).toEqual([
      range("2026-10-05T16:00:00Z", "2026-10-05T16:30:00Z"), // Mon 12:00 (afternoon)
      range("2026-10-06T13:00:00Z", "2026-10-06T13:30:00Z"), // Tue 09:00 (morning)
      range("2026-10-07T16:00:00Z", "2026-10-07T16:30:00Z"), // Wed 12:00 (afternoon)
    ]);
  });

  it("returns the requested count", () => {
    const args = { rules: WEEKDAYS_9_TO_5, busy: [], policy: policy(), now: at("2026-10-05T12:00:00Z") };
    expect(suggestSlots({ ...args, count: 2 })).toHaveLength(2);
    expect(suggestSlots({ ...args, count: 5 })).toHaveLength(5);
    expect(new Set(suggestSlots({ ...args, count: 5 }).map((s) => s.start.toISOString().slice(0, 10))).size).toBe(5);
  });

  it("falls back to the other half of the day when the preferred half is fully booked", () => {
    const slots = suggestSlots({
      rules: WEEKDAYS_9_TO_5,
      // Tuesday morning fully booked.
      busy: [range("2026-10-06T13:00:00Z", "2026-10-06T16:00:00Z")],
      policy: policy(),
      now: at("2026-10-05T12:00:00Z"),
    });
    expect(iso(slots)).toEqual([
      "2026-10-05T16:00:00.000Z", // Mon 12:00
      "2026-10-06T16:00:00.000Z", // Tue 12:00 (no morning left)
      "2026-10-07T13:00:00.000Z", // Wed 09:00 (alternates from Tue's afternoon)
    ]);
  });

  it("doubles up on a day, mixing halves, when the horizon has fewer days than slots", () => {
    const slots = suggestSlots({
      rules: WEEKDAYS_9_TO_5,
      busy: [],
      policy: policy({ horizonBusinessDays: 2 }),
      now: at("2026-10-08T22:00:00Z"), // Thu 18:00 EDT; only Friday left in the horizon
    });
    expect(iso(slots)).toEqual([
      "2026-10-09T13:00:00.000Z", // 09:00
      "2026-10-09T13:30:00.000Z", // 09:30
      "2026-10-09T16:00:00.000Z", // 12:00
    ]);
    // No two suggestions overlap.
    for (let i = 1; i < slots.length; i++) {
      expect(slots[i].start.getTime()).toBeGreaterThanOrEqual(slots[i - 1].end.getTime());
    }
  });

  it("stops at the end of the horizon", () => {
    const slots = suggestSlots({
      rules: [{ weekday: 1, startMinute: 9 * 60, endMinute: 10 * 60 }],
      busy: [],
      policy: policy({ horizonBusinessDays: 1 }),
      now: at("2026-10-05T09:00:00Z"),
      count: 3,
    });
    expect(iso(slots)).toEqual(["2026-10-05T13:00:00.000Z", "2026-10-05T13:30:00.000Z"]);
  });

  it("returns an empty list when nothing is free", () => {
    expect(
      suggestSlots({
        rules: WEEKDAYS_9_TO_5,
        busy: [range("2026-10-01T00:00:00Z", "2026-12-01T00:00:00Z")],
        policy: policy(),
        now: at("2026-10-05T12:00:00Z"),
      }),
    ).toEqual([]);
  });

  it("is deterministic and ignores the order of busy ranges", () => {
    const busy = [
      range("2026-10-06T13:00:00Z", "2026-10-06T14:00:00Z"),
      range("2026-10-05T16:00:00Z", "2026-10-05T17:00:00Z"),
    ];
    const args = { rules: WEEKDAYS_9_TO_5, policy: policy({ bufferMinutes: 10 }), now: at("2026-10-05T12:00:00Z") };
    const a = suggestSlots({ ...args, busy });
    const b = suggestSlots({ ...args, busy: [...busy].reverse() });
    expect(a).toEqual(b);
    expect(suggestSlots({ ...args, busy })).toEqual(a);
  });

  describe("New York org, London lead, across the UK clock change (25 Oct 2026)", () => {
    // Fri 23 Oct 11:00 EDT (15:00Z). London is on BST until Sun 25 Oct, then GMT;
    // New York stays on EDT until 1 Nov, so the gap shrinks from 5 h to 4 h.
    const args = { rules: WEEKDAYS_9_TO_5, busy: [], policy: policy(), now: at("2026-10-23T15:00:00Z") };

    it("without a lead zone, starts with Friday afternoon in New York", () => {
      expect(iso(suggestSlots(args))).toEqual([
        "2026-10-23T19:00:00.000Z", // Fri 15:00 EDT = 20:00 BST
        "2026-10-26T13:00:00.000Z", // Mon 09:00 EDT = 13:00 GMT
        "2026-10-27T16:00:00.000Z", // Tue 12:00 EDT = 16:00 GMT
      ]);
    });

    it("prefers slots inside the lead's working hours", () => {
      const slots = suggestSlots({ ...args, preferredTimezone: LONDON });
      expect(slots.map((s) => formatSlotFor(s, LONDON, "en-GB"))).toEqual([
        "Mon 26 Oct, 13:00–13:30 (Europe/London)",
        "Tue 27 Oct, 16:00–16:30 (Europe/London)",
        "Wed 28 Oct, 13:00–13:30 (Europe/London)",
      ]);
      expect(slots.map((s) => formatSlotFor(s, NY, "en-GB"))).toEqual([
        "Mon 26 Oct, 09:00–09:30 (America/New_York)",
        "Tue 27 Oct, 12:00–12:30 (America/New_York)",
        "Wed 28 Oct, 09:00–09:30 (America/New_York)",
      ]);
    });

    it("renders the same New York wall time one hour closer to London after the UK change", () => {
      const friday = range("2026-10-23T13:00:00Z", "2026-10-23T13:30:00Z"); // Fri 09:00 EDT
      const monday = range("2026-10-26T13:00:00Z", "2026-10-26T13:30:00Z"); // Mon 09:00 EDT
      expect(formatSlotFor(friday, LONDON, "en-GB")).toBe("Fri 23 Oct, 14:00–14:30 (Europe/London)");
      expect(formatSlotFor(monday, LONDON, "en-GB")).toBe("Mon 26 Oct, 13:00–13:30 (Europe/London)");
    });
  });

  it("still returns slots when none fall in the lead's working hours", () => {
    const args = { rules: WEEKDAYS_9_TO_5, busy: [], policy: policy(), now: at("2026-10-05T12:00:00Z") };
    // UTC+9: New York office hours are 22:00-06:00 in Tokyo.
    expect(suggestSlots({ ...args, preferredTimezone: "Asia/Tokyo" })).toEqual(suggestSlots(args));
  });
});

describe("formatInstantFor", () => {
  it("formats weekday, date, year, 24-hour time and zone", () => {
    expect(formatInstantFor(at("2026-10-06T13:05:00Z"), LONDON)).toBe("Tue 6 Oct 2026, 14:05 (Europe/London)");
    expect(formatInstantFor(at("2026-10-06T03:05:00Z"), NY)).toBe("Mon 5 Oct 2026, 23:05 (America/New_York)");
  });
});

describe("formatSlotFor", () => {
  const slot = range("2026-10-06T09:30:00Z", "2026-10-06T10:00:00Z");

  it("formats day, date, 24-hour range and zone", () => {
    expect(formatSlotFor(slot, LONDON, "en-GB")).toBe("Tue 6 Oct, 10:30–11:00 (Europe/London)");
    expect(formatSlotFor(slot, NY, "en-GB")).toBe("Tue 6 Oct, 05:30–06:00 (America/New_York)");
  });

  it("defaults to en-GB and keeps 24-hour times for other locales", () => {
    expect(formatSlotFor(slot, LONDON)).toBe("Tue 6 Oct, 10:30–11:00 (Europe/London)");
    expect(formatSlotFor(slot, LONDON, "en-US")).toBe("Tue 6 Oct, 10:30–11:00 (Europe/London)");
  });

  it("uses the local date of the zone, not UTC", () => {
    expect(formatSlotFor(range("2026-10-06T23:30:00Z", "2026-10-07T00:00:00Z"), "Asia/Karachi")).toBe(
      "Wed 7 Oct, 04:30–05:00 (Asia/Karachi)",
    );
  });
});
