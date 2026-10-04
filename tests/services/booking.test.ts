import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { DbHandle } from "@/lib/db/client";
import * as leadsRepo from "@/lib/db/repositories/leads";
import * as meetingsRepo from "@/lib/db/repositories/meetings";
import { SlotUnavailableError } from "@/lib/db/repositories/meetings";
import { bookSlot, getBookingPage, getMeetingIcs } from "@/lib/services/booking";
import { isServiceError } from "@/lib/services/errors";
import { insertOrg, startTestDb, stopTestDb } from "../db/helpers";
import { makeDeps, openEveryDay } from "./helpers";

let handle: DbHandle;

beforeAll(async () => {
  handle = await startTestDb();
}, 120_000);

afterAll(async () => {
  await stopTestDb(handle);
});

describe("booking page", () => {
  it("lists free slots grouped by day in the visitor's time zone", async () => {
    const org = await insertOrg(handle, { timezone: "Europe/London" });
    await openEveryDay(org.id);
    const page = await getBookingPage(org.bookingSlug, { timezone: "America/New_York" });
    expect(page).not.toBeNull();
    expect(page!.timezone).toBe("America/New_York");
    expect(page!.days.length).toBeGreaterThanOrEqual(9);
    expect(page!.days[0].slots[0].label).toMatch(/^\d{2}:\d{2}$/);
    expect(await getBookingPage("no-such-page")).toBeNull();
    const fallback = await getBookingPage(org.bookingSlug, { timezone: "Not/AZone" });
    expect(fallback!.timezone).toBe("Europe/London");
  });

  it("books a slot, sends the confirmation, and refuses the same slot twice", async () => {
    const org = await insertOrg(handle, { timezone: "Europe/London" });
    await openEveryDay(org.id);
    const deps = makeDeps();
    const page = await getBookingPage(org.bookingSlug);
    const slot = page!.days[1].slots[0];

    const booked = await bookSlot(
      org.bookingSlug,
      { startsAt: slot.startsAt, name: "Jonas Becker", email: "jonas@brightloop.example", timezone: "Europe/Berlin" },
      deps,
    );
    expect(booked.startsAt).toBe(slot.startsAt);
    const meeting = await meetingsRepo.getById(org.id, booked.meetingId);
    expect(meeting?.status).toBe("booked");
    const lead = await leadsRepo.getById(org.id, meeting!.leadId);
    expect(lead?.status).toBe("booked");
    expect(lead?.leadTimezone).toBe("Europe/Berlin");
    expect(deps.emailProvider.sent[0].attachments?.[0].contentType).toMatch(/text\/calendar/);

    const again = await bookSlot(
      org.bookingSlug,
      { startsAt: slot.startsAt, name: "Someone Else", email: "else@other.example" },
      deps,
    ).catch((e) => e);
    expect(again).toBeInstanceOf(SlotUnavailableError);

    const after = await getBookingPage(org.bookingSlug);
    expect(after!.days.flatMap((d) => d.slots).some((s) => s.startsAt === slot.startsAt)).toBe(false);

    const ics = await getMeetingIcs(org.bookingSlug, booked.meetingId);
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(await getMeetingIcs("wrong-slug", booked.meetingId)).toBeNull();
  });

  it("refuses a time that is not on the free list, and bad input", async () => {
    const org = await insertOrg(handle, { timezone: "UTC" });
    await openEveryDay(org.id);
    const offGrid = await bookSlot(org.bookingSlug, {
      startsAt: "2099-01-01T03:17:00.000Z",
      name: "A",
      email: "a@b.example",
    }).catch((e) => e);
    expect(offGrid).toBeInstanceOf(SlotUnavailableError);
    const bad = await bookSlot(org.bookingSlug, { startsAt: "nope", name: "", email: "x" }).catch((e) => e);
    expect(isServiceError(bad)).toBe(true);
  });
});
