import "server-only";
import { z } from "zod";
import * as leadsRepo from "@/lib/db/repositories/leads";
import * as meetingsRepo from "@/lib/db/repositories/meetings";
import * as organizationsRepo from "@/lib/db/repositories/organizations";
import { isUuid } from "@/lib/db/repositories/shared";
import type { Lead, Organization } from "@/lib/db/types";
import { isoDateInZone } from "@/lib/domain/dates";
import { buildIcs } from "@/lib/domain/ics";
import { listFreeSlots } from "@/lib/domain/slots";
import { isValidTimeZone, type Slot } from "@/lib/domain/types";
import { NotFoundError, ServiceError, SlotUnavailableError } from "./errors";
import { findDuplicateLead } from "./intake";
import { bookForLead } from "./negotiation";
import { loadSchedule } from "./scheduling";
import { appOrigin, audit, nowFrom, offerFor, type ServiceDeps } from "./shared";

/**
 * Public booking page /b/<slug> (spec 3.3): free slots for the org's horizon
 * (10 business days by default) shown in the visitor's time zone, and a
 * booking that creates the meeting, blocks the slot and sends the
 * confirmation with an .ics invite. Only a start time from the current free
 * list can be booked; the partial unique index and the overlap check in
 * meetings.create catch the race between two visitors.
 */

export type BookingSlot = { startsAt: string; endsAt: string; label: string };
export type BookingDay = { date: string; label: string; slots: BookingSlot[] };

export type BookingPage = {
  org: Pick<Organization, "name" | "bookingSlug" | "meetingLengthMinutes" | "timezone"> & { offer: string };
  /** Zone the days and times are shown in (the visitor's when valid, else the org's). */
  timezone: string;
  days: BookingDay[];
};

function timeLabel(date: Date, zone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
}

function dayLabel(date: Date, zone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: zone, weekday: "long", day: "numeric", month: "long" }).format(date);
}

async function freeSlots(org: Organization, now: Date): Promise<Slot[]> {
  const schedule = await loadSchedule(org, now);
  return listFreeSlots({ rules: schedule.rules, busy: schedule.busy, policy: schedule.policy, now }).flatMap((d) => d.slots);
}

export async function getBookingPage(
  slug: string,
  options: { timezone?: string | null } = {},
  deps?: ServiceDeps,
): Promise<BookingPage | null> {
  const org = await organizationsRepo.getByBookingSlug(slug);
  if (!org) return null;
  const zone = options.timezone && isValidTimeZone(options.timezone) ? options.timezone : org.timezone;
  const slots = await freeSlots(org, nowFrom(deps));
  const days = new Map<string, BookingDay>();
  for (const slot of slots) {
    const date = isoDateInZone(slot.start, zone);
    const day = days.get(date) ?? { date, label: dayLabel(slot.start, zone), slots: [] };
    day.slots.push({ startsAt: slot.start.toISOString(), endsAt: slot.end.toISOString(), label: timeLabel(slot.start, zone) });
    days.set(date, day);
  }
  return {
    org: {
      name: org.name,
      bookingSlug: org.bookingSlug,
      meetingLengthMinutes: org.meetingLengthMinutes,
      timezone: org.timezone,
      offer: offerFor(org),
    },
    timezone: zone,
    days: [...days.values()],
  };
}

export const BookSlotSchema = z.object({
  startsAt: z.iso.datetime({ offset: true, error: "Pick a time." }),
  name: z.string().trim().min(1, { error: "Enter your name." }).max(120),
  email: z.string().trim().toLowerCase().pipe(z.email({ error: "Enter a valid email address." })),
  timezone: z.string().trim().max(64).optional(),
  message: z.string().trim().max(2_000).optional(),
});
export type BookSlotInput = z.input<typeof BookSlotSchema>;

export type BookSlotResult = {
  meetingId: string;
  startsAt: string;
  endsAt: string;
  /** Relative download link for the invite. */
  icsPath: string;
  orgName: string;
};

/**
 * Books a slot from the public page. Throws ServiceError for bad input,
 * NotFoundError for an unknown page, SlotUnavailableError when the time is
 * no longer free (stale page or a race).
 */
export async function bookSlot(slug: string, raw: BookSlotInput, deps?: ServiceDeps): Promise<BookSlotResult> {
  const parsed = BookSlotSchema.safeParse(raw);
  if (!parsed.success) throw new ServiceError("invalid_input", parsed.error.issues[0]?.message ?? "Check the form.");
  const input = parsed.data;
  const org = await organizationsRepo.getByBookingSlug(slug);
  if (!org) throw new NotFoundError("Booking page");

  const now = nowFrom(deps);
  const start = new Date(input.startsAt);
  const slot = (await freeSlots(org, now)).find((s) => s.start.getTime() === start.getTime());
  if (!slot) throw new SlotUnavailableError();

  const timezone = input.timezone && isValidTimeZone(input.timezone) ? input.timezone : null;
  let lead: Lead | null = await findDuplicateLead(org.id, input.email, now);
  if (!lead) {
    lead = await leadsRepo.create(org.id, {
      source: "manual",
      sourceLabel: "Booking page",
      name: input.name,
      email: input.email,
      message: input.message ?? "",
      leadTimezone: timezone,
    });
    await audit({
      orgId: org.id,
      actor: "system",
      type: "lead.received",
      entityType: "lead",
      entityId: lead.id,
      input: { source: "booking_page" },
    });
  }
  const booked = await bookForLead(org, lead, slot, "system", deps);
  return {
    meetingId: booked.meeting.id,
    startsAt: slot.start.toISOString(),
    endsAt: slot.end.toISOString(),
    icsPath: `/b/${org.bookingSlug}/ics/${booked.meeting.id}`,
    orgName: org.name,
  };
}

/** Owner books a time by hand from the lead page (any future time; overlap still refused). */
export async function bookManually(
  orgId: string,
  leadId: string,
  startsAt: Date,
  userId: string | null,
  deps?: ServiceDeps,
): Promise<BookSlotResult> {
  const [org, lead] = await Promise.all([organizationsRepo.getById(orgId), leadsRepo.getById(orgId, leadId)]);
  if (!org) throw new NotFoundError("Organization");
  if (!lead) throw new NotFoundError("Lead");
  if (Number.isNaN(startsAt.getTime())) throw new ServiceError("invalid_input", "Pick a valid date and time.");
  if (startsAt.getTime() <= nowFrom(deps).getTime()) throw new ServiceError("invalid_input", "Pick a time in the future.");
  const slot = { start: startsAt, end: new Date(startsAt.getTime() + org.meetingLengthMinutes * 60_000) };
  const booked = await bookForLead(org, lead, slot, "user", deps);
  await audit({
    orgId,
    actor: "user",
    type: "meeting.booked_manually",
    entityType: "meeting",
    entityId: booked.meeting.id,
    input: { leadId, userId },
  });
  return {
    meetingId: booked.meeting.id,
    startsAt: slot.start.toISOString(),
    endsAt: slot.end.toISOString(),
    icsPath: `/b/${org.bookingSlug}/ics/${booked.meeting.id}`,
    orgName: org.name,
  };
}

/** The meeting's invite for /b/<slug>/ics/<meetingId>, or null when the pair does not match. */
export async function getMeetingIcs(slug: string, meetingId: string, deps?: ServiceDeps): Promise<string | null> {
  if (!isUuid(meetingId)) return null;
  const org = await organizationsRepo.getByBookingSlug(slug);
  if (!org) return null;
  const meeting = await meetingsRepo.getById(org.id, meetingId);
  if (!meeting) return null;
  const lead = await leadsRepo.getById(org.id, meeting.leadId);
  if (!lead) return null;
  let host = "firstreply.app";
  try {
    host = new URL(appOrigin()).hostname;
  } catch {
    // keep the default
  }
  return buildIcs({
    uid: meeting.icsUid,
    start: meeting.startsAt,
    end: meeting.endsAt,
    summary: `${org.name} and ${lead.name ?? lead.email}`,
    description: `${offerFor(org)}. Booked with Firstreply.`,
    organizerEmail: `bookings@${host}`,
    organizerName: org.name,
    attendeeEmail: lead.email,
    attendeeName: lead.name ?? undefined,
    now: nowFrom(deps),
  });
}

/** Owner marks a meeting held, no-show or cancelled (spec 3.6 no-show rate). */
export async function setMeetingStatus(
  orgId: string,
  meetingId: string,
  status: "held" | "no_show" | "cancelled" | "booked",
  userId: string | null,
): Promise<void> {
  const meeting = await meetingsRepo.updateStatus(orgId, meetingId, status);
  if (!meeting) throw new NotFoundError("Meeting");
  await audit({
    orgId,
    actor: "user",
    type: `meeting.${status}`,
    entityType: "meeting",
    entityId: meetingId,
    input: { userId, leadId: meeting.leadId },
  });
}
