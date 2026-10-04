// Provenance: copied from certchase/tests/domain/dates.test.ts alongside lib/domain/dates.ts.
import { describe, expect, it } from "vitest";
import {
  addDaysToIsoDate,
  daysBetweenIsoDates,
  getZonedParts,
  isValidIsoDate,
  isoDateFromDate,
  isoDateInZone,
  isoDateToUtc,
  isoWeekday,
  zonedTimeToUtc,
} from "@/lib/domain/dates";

describe("isValidIsoDate", () => {
  it.each(["2026-10-03", "2024-02-29"])("accepts %s", (d) => {
    expect(isValidIsoDate(d)).toBe(true);
  });
  it.each(["2026-02-29", "2026-13-01", "2026-1-01", "26-10-03", "2026-10-03T00:00:00Z", ""])(
    "rejects %s",
    (d) => {
      expect(isValidIsoDate(d)).toBe(false);
    },
  );
});

describe("calendar arithmetic", () => {
  it("adds days across month and year boundaries", () => {
    expect(addDaysToIsoDate("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDaysToIsoDate("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysToIsoDate("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDaysToIsoDate("2026-03-07", 1)).toBe("2026-03-08");
  });

  it("is unaffected by DST transitions (pure calendar math)", () => {
    expect(addDaysToIsoDate("2026-03-07", 30)).toBe("2026-04-06");
  });

  it("isoWeekday is 1=Mon..7=Sun", () => {
    expect(isoWeekday("2026-10-03")).toBe(6);
    expect(isoWeekday("2026-10-04")).toBe(7);
    expect(isoWeekday("2026-10-05")).toBe(1);
  });

  it("converts between IsoDate and UTC-midnight Date", () => {
    expect(isoDateToUtc("2026-10-03").toISOString()).toBe("2026-10-03T00:00:00.000Z");
    expect(isoDateFromDate(new Date("2026-10-03T23:59:59Z"))).toBe("2026-10-03");
  });
});

describe("time zones", () => {
  it("reads local wall-clock parts", () => {
    const parts = getZonedParts(new Date("2026-10-02T23:30:00Z"), "Asia/Karachi");
    expect(parts).toMatchObject({ year: 2026, month: 10, day: 3, hour: 4, minute: 30, weekday: 6 });
  });

  it("reports midnight as hour 0, not 24", () => {
    expect(getZonedParts(new Date("2026-10-03T04:00:00Z"), "America/New_York").hour).toBe(0);
  });

  it("isoDateInZone uses the local calendar date", () => {
    const instant = new Date("2026-10-03T02:00:00Z");
    expect(isoDateInZone(instant, "America/New_York")).toBe("2026-10-02");
    expect(isoDateInZone(instant, "Asia/Karachi")).toBe("2026-10-03");
  });

  it("converts local wall time to UTC on both sides of New York DST", () => {
    expect(zonedTimeToUtc("2026-03-06", 9, 0, "America/New_York").toISOString()).toBe(
      "2026-03-06T14:00:00.000Z",
    );
    expect(zonedTimeToUtc("2026-03-09", 9, 0, "America/New_York").toISOString()).toBe(
      "2026-03-09T13:00:00.000Z",
    );
    expect(zonedTimeToUtc("2026-11-02", 9, 0, "America/New_York").toISOString()).toBe(
      "2026-11-02T14:00:00.000Z",
    );
  });

  it("moves a non-existent spring-forward time forward, not back", () => {
    // 02:30 does not exist on 2026-03-08 in New York; 03:30 EDT is 07:30Z.
    expect(zonedTimeToUtc("2026-03-08", 2, 30, "America/New_York").toISOString()).toBe(
      "2026-03-08T07:30:00.000Z",
    );
  });

  it("picks the earlier instant for an ambiguous fall-back time", () => {
    // 01:30 occurs twice on 2026-11-01; first occurrence is 01:30 EDT = 05:30Z.
    expect(zonedTimeToUtc("2026-11-01", 1, 30, "America/New_York").toISOString()).toBe(
      "2026-11-01T05:30:00.000Z",
    );
  });

  it("handles a zone without DST (Asia/Karachi, UTC+5)", () => {
    expect(zonedTimeToUtc("2026-07-01", 8, 0, "Asia/Karachi").toISOString()).toBe(
      "2026-07-01T03:00:00.000Z",
    );
  });

  it("throws on an unknown time zone", () => {
    expect(() => zonedTimeToUtc("2026-07-01", 8, 0, "Mars/Olympus")).toThrow(RangeError);
  });
});

describe("daysBetweenIsoDates", () => {
  it("counts whole calendar days, negative when the target is earlier", () => {
    expect(daysBetweenIsoDates("2026-10-03", "2026-10-15")).toBe(12);
    expect(daysBetweenIsoDates("2026-10-03", "2026-09-30")).toBe(-3);
    expect(daysBetweenIsoDates("2026-10-03", "2026-10-03")).toBe(0);
  });

  it("is not shortened by a DST change", () => {
    expect(daysBetweenIsoDates("2026-03-07", "2026-03-09")).toBe(2);
    expect(daysBetweenIsoDates("2026-10-31", "2026-11-02")).toBe(2);
  });

  it("throws on an invalid date", () => {
    expect(() => daysBetweenIsoDates("2026-02-30", "2026-03-01")).toThrow(RangeError);
  });
});
