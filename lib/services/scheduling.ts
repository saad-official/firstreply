import "server-only";
import * as availabilityRepo from "@/lib/db/repositories/availability";
import * as meetingsRepo from "@/lib/db/repositories/meetings";
import type { AvailabilityRuleInput, Organization } from "@/lib/db/types";
import { isoDateInZone } from "@/lib/domain/dates";
import { formatSlotFor, suggestSlots } from "@/lib/domain/slots";
import type { AvailabilityRule, Busy, Slot, SlotPolicy } from "@/lib/domain/types";

/**
 * Bridges the stored availability (weekday 0 = Sunday .. 6 = Saturday, as
 * JS getDay) to the slot engine (ISO weekday 1 = Monday .. 7 = Sunday) and
 * loads everything the engine needs for one org at one instant.
 */

const DAY_MS = 86_400_000;
/** Busy ranges are loaded this far ahead (covers a 60-business-day horizon). */
const BUSY_WINDOW_DAYS = 100;

export function toDomainRule(rule: AvailabilityRuleInput): AvailabilityRule {
  return { weekday: rule.weekday === 0 ? 7 : rule.weekday, startMinute: rule.startMinute, endMinute: rule.endMinute };
}

export function toDomainRules(rules: readonly AvailabilityRuleInput[]): AvailabilityRule[] {
  return rules.map(toDomainRule);
}

export type Schedule = {
  rules: AvailabilityRule[];
  policy: SlotPolicy;
  busy: Busy[];
};

type SchedulingOrg = Pick<
  Organization,
  "id" | "timezone" | "meetingLengthMinutes" | "bufferMinutes" | "minNoticeHours" | "horizonBusinessDays"
>;

export async function loadSchedule(org: SchedulingOrg, now: Date): Promise<Schedule> {
  const today = isoDateInZone(now, org.timezone);
  const [rules, blackouts, busy] = await Promise.all([
    availabilityRepo.listRules(org.id),
    availabilityRepo.listBlackouts(org.id, { from: today }),
    meetingsRepo.listBusy(org.id, new Date(now.getTime() - DAY_MS), new Date(now.getTime() + BUSY_WINDOW_DAYS * DAY_MS)),
  ]);
  return {
    rules: toDomainRules(rules),
    policy: {
      timezone: org.timezone,
      meetingMinutes: org.meetingLengthMinutes,
      bufferMinutes: org.bufferMinutes,
      minNoticeHours: org.minNoticeHours,
      horizonBusinessDays: org.horizonBusinessDays,
      blackoutDates: blackouts.map((b) => b.date),
    },
    busy: busy.map((b) => ({ start: b.startsAt, end: b.endsAt })),
  };
}

/** Three spread slots for a first reply, in chronological order. */
export function pickSlots(schedule: Schedule, now: Date, leadTimezone: string | null, count = 3): Slot[] {
  return suggestSlots({
    rules: schedule.rules,
    busy: schedule.busy,
    policy: schedule.policy,
    now,
    count,
    preferredTimezone: leadTimezone ?? undefined,
  });
}

/** Slot strings exactly as the reply quotes them (and the guardrail checks them). */
export function formatSlots(slots: readonly Slot[], zone: string): string[] {
  return slots.map((s) => formatSlotFor(s, zone));
}

export function slotFromOffer(offer: { startsAt: Date; endsAt: Date }): Slot {
  return { start: offer.startsAt, end: offer.endsAt };
}
