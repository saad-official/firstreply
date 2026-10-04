/**
 * Deterministic handling of a classified lead reply (spec 3.5). The model only
 * classifies; this decides what happens next, so bookings never depend on the
 * model's judgement about availability.
 *
 * Decisions where the spec is silent:
 * - Accepting an offered slot books it if it is still in the future and not
 *   busy (buffer applied). Minimum notice is not re-applied: we offered it.
 * - A proposed time must fit the availability rules, blackouts, minimum notice
 *   and busy ranges, but not the 30-minute grid or the horizon (the horizon
 *   limits what we offer, not what we accept).
 * - A counter to a proposal offers the free slots closest to the proposed time;
 *   a counter to a taken slot offers fresh suggestions.
 * - Follow-ups land at the start of the org's first working day on/after the
 *   target date, and never in the past.
 */
import { addDaysToIsoDate, getZonedParts, isoDateInZone, isoWeekday, zonedTimeToUtc } from "./dates";
import { isSlotFree, listFreeSlots, suggestSlots } from "./slots";
import {
  isValidTimeZone,
  MINUTES_PER_DAY,
  PROPOSED_START_PATTERN,
  type AvailabilityRule,
  type Busy,
  type IsoDate,
  type LeadStatus,
  type ReplyClassification,
  type Slot,
  type SlotPolicy,
} from "./types";

export const MIN_CLASSIFICATION_CONFIDENCE = 0.6;
export const COUNTER_SLOT_COUNT = 2;
export const OUT_OF_OFFICE_DEFAULT_DAYS = 7;
const DEFAULT_FOLLOW_UP_MINUTE = 9 * 60;
const MAX_FOLLOW_UP_SHIFT_DAYS = 31;
const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;

export type NegotiationAction = "book" | "counter" | "draft_answer" | "close" | "follow_up_later" | "review";

export interface NegotiationContext {
  /** Slots offered in our last message, in the order shown ([0], [1], [2]). */
  offeredSlots: readonly Slot[];
  policy: SlotPolicy;
  rules: readonly AvailabilityRule[];
  busy: readonly Busy[];
  now: Date;
  /** Lead's known zone; used when the classification names none. */
  leadTimezone?: string;
}

export interface NegotiationOutcome {
  /** New lead status; absent when the status should not change. */
  leadStatus?: LeadStatus;
  action: NegotiationAction;
  bookSlot?: Slot;
  counterSlots?: Slot[];
  followUpAt?: Date;
  closeReason?: string;
  /** Human-readable next steps for the owner's queue. */
  tasks: string[];
}

const BOOK_TASK = "Send the booking confirmation with a calendar invite.";

const review = (reason: string): NegotiationOutcome => ({ action: "review", tasks: [`Review the reply: ${reason}`] });

const book = (slot: Slot): NegotiationOutcome => ({ leadStatus: "booked", action: "book", bookSlot: slot, tasks: [BOOK_TASK] });

/**
 * Proposed start as an instant. Wall-clock values are read in `timeZone`
 * (DST-aware); values with "Z" or an offset are absolute. Null when invalid.
 */
export function parseProposedStart(value: string, timeZone: string): Date | null {
  const m = PROPOSED_START_PATTERN.exec(value.trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = [1, 2, 3, 4, 5].map((i) => Number(m[i]));
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  if (h > 23 || mi > 59) return null;
  if (m[7]) {
    const instant = new Date(value.trim());
    return Number.isNaN(instant.getTime()) ? null : instant;
  }
  return zonedTimeToUtc(`${m[1]}-${m[2]}-${m[3]}`, h, mi, timeZone);
}

/** Slot lies inside one availability window on a non-blackout org-local day. */
export function isWithinAvailability(
  slot: Slot,
  rules: readonly AvailabilityRule[],
  policy: Pick<SlotPolicy, "timezone" | "blackoutDates">,
): boolean {
  const date = isoDateInZone(slot.start, policy.timezone);
  if (policy.blackoutDates.includes(date)) return false;
  const s = getZonedParts(slot.start, policy.timezone);
  const startMinute = s.hour * 60 + s.minute;
  const durationMinutes = (slot.end.getTime() - slot.start.getTime()) / MS_PER_MINUTE;
  const weekday = isoWeekday(date);
  return rules.some((rule) => {
    if (rule.weekday !== weekday || startMinute < rule.startMinute) return false;
    // Measure the end on the absolute clock so a DST change mid-window cannot stretch it.
    const windowEnd =
      rule.endMinute >= MINUTES_PER_DAY
        ? zonedTimeToUtc(addDaysToIsoDate(date, 1), 0, 0, policy.timezone)
        : zonedTimeToUtc(date, Math.floor(rule.endMinute / 60), rule.endMinute % 60, policy.timezone);
    return durationMinutes > 0 && slot.end.getTime() <= windowEnd.getTime();
  });
}

function counter(slots: Slot[], why: string): NegotiationOutcome {
  return {
    leadStatus: "negotiating",
    action: "counter",
    counterSlots: slots,
    tasks: [`${why}: approve a counter with ${slots.length} alternatives.`],
  };
}

function handleAccept(c: ReplyClassification, ctx: NegotiationContext): NegotiationOutcome {
  const index = c.acceptedSlotIndex ?? (ctx.offeredSlots.length === 1 ? 0 : null);
  const slot = index === null ? undefined : ctx.offeredSlots[index];
  if (!slot) return review("the lead accepted a slot but it is unclear which one.");

  const stillFree = slot.start.getTime() > ctx.now.getTime() && isSlotFree(slot, ctx.busy, ctx.policy.bufferMinutes);
  if (stillFree) return book(slot);

  const alternatives = suggestSlots({
    rules: ctx.rules,
    busy: ctx.busy,
    policy: ctx.policy,
    now: ctx.now,
    count: COUNTER_SLOT_COUNT,
    preferredTimezone: ctx.leadTimezone,
  });
  if (alternatives.length === 0) return review("the chosen slot is taken and no alternatives are free in the horizon.");
  return counter(alternatives, "The chosen slot is no longer free");
}

function handlePropose(c: ReplyClassification, ctx: NegotiationContext): NegotiationOutcome {
  const zone =
    [c.proposedTimezone, ctx.leadTimezone].find((z): z is string => typeof z === "string" && isValidTimeZone(z)) ??
    ctx.policy.timezone;
  const start = c.proposedStart ? parseProposedStart(c.proposedStart, zone) : null;
  if (!start) return review("the lead proposed a time that could not be read.");

  const slot: Slot = { start, end: new Date(start.getTime() + ctx.policy.meetingMinutes * MS_PER_MINUTE) };
  const earliest = ctx.now.getTime() + ctx.policy.minNoticeHours * MS_PER_HOUR;
  const bookable =
    start.getTime() >= earliest &&
    isWithinAvailability(slot, ctx.rules, ctx.policy) &&
    isSlotFree(slot, ctx.busy, ctx.policy.bufferMinutes);
  if (bookable) return book(slot);

  const target = start.getTime();
  const closest = listFreeSlots({ rules: ctx.rules, busy: ctx.busy, policy: ctx.policy, now: ctx.now })
    .flatMap((day) => day.slots)
    .sort((a, b) => Math.abs(a.start.getTime() - target) - Math.abs(b.start.getTime() - target) || a.start.getTime() - b.start.getTime())
    .slice(0, COUNTER_SLOT_COUNT)
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  if (closest.length === 0) return review("the proposed time is not available and no alternatives are free in the horizon.");
  return counter(closest, "The proposed time is not available");
}

function handleOutOfOffice(c: ReplyClassification, ctx: NegotiationContext): NegotiationOutcome {
  const { timezone, blackoutDates } = ctx.policy;
  const today = isoDateInZone(ctx.now, timezone);
  let date: IsoDate = c.returnDate ? addDaysToIsoDate(c.returnDate, 1) : addDaysToIsoDate(today, OUT_OF_OFFICE_DEFAULT_DAYS);
  if (date <= today) date = addDaysToIsoDate(today, 1);

  const startOfDay = (d: IsoDate): number | null => {
    const starts = ctx.rules.filter((r) => r.weekday === isoWeekday(d)).map((r) => r.startMinute);
    return starts.length > 0 ? Math.min(...starts) : null;
  };
  let minute = DEFAULT_FOLLOW_UP_MINUTE;
  if (ctx.rules.length > 0) {
    for (let i = 0; i < MAX_FOLLOW_UP_SHIFT_DAYS; i++) {
      const start = startOfDay(date);
      if (start !== null && !blackoutDates.includes(date)) {
        minute = start;
        break;
      }
      date = addDaysToIsoDate(date, 1);
    }
  }

  const followUpAt = zonedTimeToUtc(date, Math.floor(minute / 60), minute % 60, timezone);
  const why = c.returnDate ? `lead is out of office until ${c.returnDate}` : "no return date given";
  return { action: "follow_up_later", followUpAt, tasks: [`Follow up on ${date} (${why}).`] };
}

export function handleReply(classification: ReplyClassification, ctx: NegotiationContext): NegotiationOutcome {
  if (!(classification.confidence >= MIN_CLASSIFICATION_CONFIDENCE)) {
    return review(`low classification confidence (${classification.confidence}).`);
  }
  switch (classification.intent) {
    case "accepts_slot":
      return handleAccept(classification, ctx);
    case "proposes_time":
      return handlePropose(classification, ctx);
    case "asks_question":
      return {
        leadStatus: "negotiating",
        action: "draft_answer",
        tasks: ["Draft an answer to the lead's question for approval."],
      };
    case "not_interested":
      return {
        leadStatus: "declined",
        action: "close",
        closeReason: classification.summary,
        tasks: [`Close the lead: ${classification.summary}`],
      };
    case "out_of_office":
      return handleOutOfOffice(classification, ctx);
    case "other":
      return review(classification.summary);
  }
}

/** Lines where a quoted earlier message starts (Gmail, Apple Mail, Outlook). */
const QUOTE_START: RegExp[] = [
  /^On .+wrote:\s*$/,
  /^-{2,}\s*Original Message\s*-{2,}/i,
  /^From:\s.+/,
  /^_{5,}\s*$/,
  /^>/,
];

/**
 * The lead's new text only, without the quoted thread below it, so the
 * classifier never reads our own slots back as the lead's choice.
 */
export function stripQuotedReply(text: string): string {
  const lines = text.split(/\r?\n/);
  const cut = lines.findIndex((line) => QUOTE_START.some((p) => p.test(line.trim())));
  return (cut === -1 ? lines : lines.slice(0, cut)).join("\n").trim();
}
