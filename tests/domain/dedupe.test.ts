import { describe, expect, it } from "vitest";
import { DEDUPE_WINDOW_DAYS, leadKey, shouldMergeIntoExisting } from "@/lib/domain/dedupe";

const NOW = new Date("2026-10-04T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

describe("shouldMergeIntoExisting", () => {
  it("defaults to a 30-day window", () => {
    expect(DEDUPE_WINDOW_DAYS).toBe(30);
  });

  it("merges a lead created within the window", () => {
    expect(shouldMergeIntoExisting(daysAgo(0), NOW)).toBe(true);
    expect(shouldMergeIntoExisting(daysAgo(29.99), NOW)).toBe(true);
  });

  it("starts a new lead at exactly 30 days and beyond", () => {
    expect(shouldMergeIntoExisting(daysAgo(30), NOW)).toBe(false);
    expect(shouldMergeIntoExisting(daysAgo(45), NOW)).toBe(false);
  });

  it("honours a custom window", () => {
    expect(shouldMergeIntoExisting(daysAgo(6), NOW, 7)).toBe(true);
    expect(shouldMergeIntoExisting(daysAgo(8), NOW, 7)).toBe(false);
  });

  it("merges when the existing lead is slightly in the future (clock skew)", () => {
    expect(shouldMergeIntoExisting(new Date(NOW.getTime() + 5_000), NOW)).toBe(true);
  });

  it("does not merge with an invalid date", () => {
    expect(shouldMergeIntoExisting(new Date("nope"), NOW)).toBe(false);
  });
});

describe("leadKey", () => {
  it.each([
    ["  Maya.Patel+leads@GMAIL.com ", "mayapatel@gmail.com"],
    ["maya.patel@googlemail.com", "mayapatel@gmail.com"],
    ["maya.patel+web@outlook.com", "maya.patel@outlook.com"],
    ["maya+x@icloud.com", "maya@icloud.com"],
    ["maya+x@proton.me", "maya@proton.me"],
    ["Maya.Patel@Northwind.Example", "maya.patel@northwind.example"],
    ["maya+sales@northwind.example", "maya+sales@northwind.example"],
  ])("%j -> %j", (email, key) => {
    expect(leadKey(email)).toBe(key);
  });

  it("returns the trimmed lower-case input when it has no @", () => {
    expect(leadKey("  Not-An-Email ")).toBe("not-an-email");
  });
});
