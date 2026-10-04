/**
 * Availability and slot suggestion (spec 3.3). Deterministic and pure: the
 * caller injects `now`, the rules, existing busy ranges and the policy.
 *
 * Rules and blackouts are read in the org's time zone, so "09:00" stays 09:00
 * local on both sides of a DST change (Intl-only, see ./dates).
 *
 * Decisions where the spec is silent:
 * - A "business day" is a date whose weekday has at least one rule and that is
 *   not a blackout. Today counts as day 1 of the horizon even if its remaining
 *   hours are past.
 * - "Morning" is a start before 12:00 org-local; "afternoon" is 12:00 or later.
 * - The lead's "working hours" (for `preferredTimezone`) are 08:00-19:00 local.
 */
import {
  addDaysToIsoDate,
  getZonedParts,
  isoDateInZone,
  isoWeekday,
  zonedTimeToUtc,
} from "./dates";
import { MINUTES_PER_DAY, type AvailabilityRule, type Busy, type IsoDate, type Slot, type SlotPolicy } from "./types";

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;
/** Slot starts are aligned to this many minutes past local midnight. */
export const SLOT_ALIGNMENT_MINUTES = 30;
const NOON_MINUTE = 12 * 60;
const LEAD_DAY_START_MINUTE = 8 * 60;
const LEAD_DAY_END_MINUTE = 19 * 60;
/** Safety bound for the business-day scan (rules may cover only one weekday). */
const MAX_SCAN_DAYS = 400;

export interface SlotInputs {
  rules: readonly AvailabilityRule[];
  busy: readonly Busy[];
  policy: SlotPolicy;
  now: Date;
}

export interface SuggestSlotsInput extends SlotInputs {
  count?: number;
  /** Lead's probable IANA zone; slots inside their 08:00-19:00 are preferred. */
  preferredTimezone?: string;
}

export interface DaySlots {
  /** Org-local calendar date. */
  date: IsoDate;
  slots: Slot[];
}

/** True when `slot` does not overlap any busy range padded by `bufferMinutes` on both sides. */
export function isSlotFree(slot: Slot, busy: readonly Busy[], bufferMinutes: number): boolean {
  const pad = Math.max(0, bufferMinutes) * MS_PER_MINUTE;
  const start = slot.start.getTime();
  const end = slot.end.getTime();
  return busy.every((b) => end <= b.start.getTime() - pad || start >= b.end.getTime() + pad);
}

/** Org-local business days in the horizon, starting today. */
export function businessDaysInHorizon(
  rules: readonly AvailabilityRule[],
  policy: Pick<SlotPolicy, "timezone" | "horizonBusinessDays" | "blackoutDates">,
  now: Date,
): IsoDate[] {
  const workingWeekdays = new Set(rules.map((r) => r.weekday));
  if (workingWeekdays.size === 0) return [];
  const blackouts = new Set(policy.blackoutDates);
  const days: IsoDate[] = [];
  let date = isoDateInZone(now, policy.timezone);
  for (let i = 0; i < MAX_SCAN_DAYS && days.length < policy.horizonBusinessDays; i++) {
    if (workingWeekdays.has(isoWeekday(date)) && !blackouts.has(date)) days.push(date);
    date = addDaysToIsoDate(date, 1);
  }
  return days;
}

/** Instant of `minute` minutes after local midnight on `date` (1440 = next midnight). */
function localMinuteToUtc(date: IsoDate, minute: number, timeZone: string): Date {
  if (minute >= MINUTES_PER_DAY) return zonedTimeToUtc(addDaysToIsoDate(date, 1), 0, 0, timeZone);
  return zonedTimeToUtc(date, Math.floor(minute / 60), minute % 60, timeZone);
}

/** Aligned candidate starts on one org-local day, before notice and busy checks. */
function candidatesForDay(date: IsoDate, rules: readonly AvailabilityRule[], policy: SlotPolicy): Slot[] {
  const weekday = isoWeekday(date);
  const durationMs = policy.meetingMinutes * MS_PER_MINUTE;
  const byStart = new Map<number, Slot>();
  for (const rule of rules) {
    if (rule.weekday !== weekday) continue;
    const windowEnd = localMinuteToUtc(date, rule.endMinute, policy.timezone).getTime();
    const firstStart = Math.ceil(rule.startMinute / SLOT_ALIGNMENT_MINUTES) * SLOT_ALIGNMENT_MINUTES;
    for (let minute = firstStart; minute + policy.meetingMinutes <= rule.endMinute; minute += SLOT_ALIGNMENT_MINUTES) {
      const hour = Math.floor(minute / 60);
      const start = zonedTimeToUtc(date, hour, minute % 60, policy.timezone);
      // Skip wall-clock times that do not exist (spring-forward gap).
      const parts = getZonedParts(start, policy.timezone);
      if (parts.hour !== hour || parts.minute !== minute % 60) continue;
      const end = start.getTime() + durationMs;
      if (end > windowEnd) continue;
      byStart.set(start.getTime(), { start, end: new Date(end) });
    }
  }
  return [...byStart.values()].sort((a, b) => a.start.getTime() - b.start.getTime());
}

/** All free slots in the horizon, grouped by org-local day (days without slots omitted). For the booking page. */
export function listFreeSlots({ rules, busy, policy, now }: SlotInputs): DaySlots[] {
  const earliest = now.getTime() + policy.minNoticeHours * MS_PER_HOUR;
  return businessDaysInHorizon(rules, policy, now)
    .map((date) => ({
      date,
      slots: candidatesForDay(date, rules, policy).filter(
        (slot) => slot.start.getTime() >= earliest && isSlotFree(slot, busy, policy.bufferMinutes),
      ),
    }))
    .filter((day) => day.slots.length > 0);
}

type Half = "morning" | "afternoon";

function halfOf(slot: Slot, timeZone: string): Half {
  const p = getZonedParts(slot.start, timeZone);
  return p.hour * 60 + p.minute < NOON_MINUTE ? "morning" : "afternoon";
}

const opposite = (half: Half): Half => (half === "morning" ? "afternoon" : "morning");

function overlaps(a: Slot, b: Slot): boolean {
  return a.start.getTime() < b.end.getTime() && b.start.getTime() < a.end.getTime();
}

function withinLeadHours(slot: Slot, timeZone: string): boolean {
  const s = getZonedParts(slot.start, timeZone);
  const e = getZonedParts(slot.end, timeZone);
  const startMinute = s.hour * 60 + s.minute;
  const endMinute = e.hour * 60 + e.minute;
  const sameDay = s.year === e.year && s.month === e.month && s.day === e.day;
  return sameDay && startMinute >= LEAD_DAY_START_MINUTE && endMinute <= LEAD_DAY_END_MINUTE;
}

/**
 * Spread picks across days: one slot per new day (earliest first, then
 * alternating morning/afternoon), then round-robin extra slots on days
 * already used, preferring the half of the day not yet offered.
 */
function pickSpread(days: readonly DaySlots[], count: number, timeZone: string, initial: readonly Slot[]): Slot[] {
  const picks: Slot[] = [...initial];
  const dayOf = (slot: Slot) => isoDateInZone(slot.start, timeZone);
  const usedDays = new Set(picks.map(dayOf));
  let prefer: Half | null = picks.length > 0 ? opposite(halfOf(picks[picks.length - 1], timeZone)) : null;

  for (const day of days) {
    if (picks.length >= count) break;
    if (usedDays.has(day.date)) continue;
    const available = day.slots.filter((s) => !picks.some((p) => overlaps(p, s)));
    if (available.length === 0) continue;
    const chosen = (prefer && available.find((s) => halfOf(s, timeZone) === prefer)) || available[0];
    picks.push(chosen);
    usedDays.add(day.date);
    prefer = opposite(halfOf(chosen, timeZone));
  }

  let progressed = true;
  while (picks.length < count && progressed) {
    progressed = false;
    for (const day of days) {
      if (picks.length >= count) break;
      const available = day.slots.filter((s) => !picks.some((p) => overlaps(p, s)));
      if (available.length === 0) continue;
      const halvesUsed = new Set(picks.filter((p) => dayOf(p) === day.date).map((p) => halfOf(p, timeZone)));
      const chosen = available.find((s) => !halvesUsed.has(halfOf(s, timeZone))) ?? available[0];
      picks.push(chosen);
      progressed = true;
    }
  }
  return picks;
}

/**
 * Up to `count` free slots for a first reply: the earliest free slot, then one
 * per following day alternating morning/afternoon, inside the lead's working
 * hours when `preferredTimezone` is known (falling back to any free slot).
 * Returned in chronological order.
 */
export function suggestSlots({ count = 3, preferredTimezone, ...inputs }: SuggestSlotsInput): Slot[] {
  if (count <= 0) return [];
  const timeZone = inputs.policy.timezone;
  const days = listFreeSlots(inputs);
  let picks: Slot[] = [];
  if (preferredTimezone) {
    const friendly = days
      .map((d) => ({ date: d.date, slots: d.slots.filter((s) => withinLeadHours(s, preferredTimezone)) }))
      .filter((d) => d.slots.length > 0);
    picks = pickSpread(friendly, count, timeZone, []);
  }
  if (picks.length < count) picks = pickSpread(days, count, timeZone, picks);
  return picks.sort((a, b) => a.start.getTime() - b.start.getTime());
}

const pad2 = (n: number) => String(n).padStart(2, "0");

function dayAndMonthNames(date: Date, timezone: string, locale: string): { weekday: string; month: string } {
  const names = new Intl.DateTimeFormat(locale, { timeZone: timezone, weekday: "short", month: "short" });
  const parts = names.formatToParts(date);
  return {
    weekday: parts.find((p) => p.type === "weekday")?.value ?? "",
    month: parts.find((p) => p.type === "month")?.value ?? "",
  };
}

/**
 * "Tue 7 Oct, 10:30–11:00 (Europe/London)". Weekday and month names follow
 * `locale`; times are always 24-hour so the string is stable for guardrails.
 */
export function formatSlotFor(slot: Slot, timezone: string, locale = "en-GB"): string {
  const { weekday, month } = dayAndMonthNames(slot.start, timezone, locale);
  const s = getZonedParts(slot.start, timezone);
  const e = getZonedParts(slot.end, timezone);
  return `${weekday} ${s.day} ${month}, ${pad2(s.hour)}:${pad2(s.minute)}–${pad2(e.hour)}:${pad2(e.minute)} (${timezone})`;
}

/** "Tue 6 Oct 2026, 14:05 (Europe/London)": an instant for prompts (received-at, now). */
export function formatInstantFor(date: Date, timezone: string, locale = "en-GB"): string {
  const { weekday, month } = dayAndMonthNames(date, timezone, locale);
  const p = getZonedParts(date, timezone);
  return `${weekday} ${p.day} ${month} ${p.year}, ${pad2(p.hour)}:${pad2(p.minute)} (${timezone})`;
}
