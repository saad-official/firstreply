/**
 * Provenance: copied verbatim from certchase/lib/domain/dates.ts (2026-10-04),
 * which was itself adapted from the Dunnit domain core. Keep the two in sync.
 */
/**
 * Calendar and time-zone helpers built on Intl only (no tz library).
 * IsoDate values ("YYYY-MM-DD") are pure calendar dates; arithmetic on them is
 * done in UTC so DST can never shift a day.
 * Adapted from the Dunnit domain core (same Intl-only approach).
 */
import type { IsoDate } from "./types";

export const MS_PER_DAY = 86_400_000;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidIsoDate(value: string): boolean {
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

function assertIsoDate(value: string): void {
  if (!isValidIsoDate(value)) throw new RangeError(`Invalid ISO date: ${value}`);
}

/** Midnight UTC of the calendar date. */
export function isoDateToUtc(date: IsoDate): Date {
  assertIsoDate(date);
  return new Date(`${date}T00:00:00.000Z`);
}

/** Calendar date of an instant, read in UTC. */
export function isoDateFromDate(date: Date): IsoDate {
  return date.toISOString().slice(0, 10);
}

export function addDaysToIsoDate(date: IsoDate, days: number): IsoDate {
  return isoDateFromDate(new Date(isoDateToUtc(date).getTime() + days * MS_PER_DAY));
}

/** ISO weekday: 1 = Monday ... 7 = Sunday. */
export function isoWeekday(date: IsoDate): number {
  const day = isoDateToUtc(date).getUTCDay();
  return day === 0 ? 7 : day;
}

/** Whole calendar days from `from` to `to` (negative if `to` is earlier). */
export function daysBetweenIsoDates(from: IsoDate, to: IsoDate): number {
  return Math.round((isoDateToUtc(to).getTime() - isoDateToUtc(from).getTime()) / MS_PER_DAY);
}

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 1 = Monday ... 7 = Sunday */
  weekday: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    // Throws RangeError for unknown zones.
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
      hourCycle: "h23",
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

export function getZonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = formatterFor(timeZone).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? "";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")) % 24,
    minute: Number(get("minute")),
    second: Number(get("second")),
    weekday: WEEKDAYS[get("weekday")] ?? 0,
  };
}

/** Calendar date of an instant as seen in `timeZone`. */
export function isoDateInZone(date: Date, timeZone: string): IsoDate {
  const p = getZonedParts(date, timeZone);
  return `${String(p.year).padStart(4, "0")}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** local wall clock minus UTC, in ms, at the given instant. */
function zoneOffsetMs(epochMs: number, timeZone: string): number {
  const p = getZonedParts(new Date(epochMs), timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(epochMs / 1000) * 1000;
}

/**
 * UTC instant for a local wall-clock time in `timeZone`.
 * Non-existent times (spring-forward gap) resolve forward by the gap size;
 * ambiguous times (fall-back overlap) resolve to the earlier instant.
 */
export function zonedTimeToUtc(date: IsoDate, hour: number, minute: number, timeZone: string): Date {
  const [y, mo, d] = date.split("-").map(Number);
  assertIsoDate(date);
  const wallAsUtc = Date.UTC(y, mo - 1, d, hour, minute);
  const matches = (epoch: number): boolean => {
    const p = getZonedParts(new Date(epoch), timeZone);
    return p.year === y && p.month === mo && p.day === d && p.hour === hour && p.minute === minute;
  };
  const first = wallAsUtc - zoneOffsetMs(wallAsUtc, timeZone);
  const second = wallAsUtc - zoneOffsetMs(first, timeZone);
  const candidates = [first, second].filter(matches).sort((a, b) => a - b);
  if (candidates.length > 0) return new Date(candidates[0]);
  return new Date(Math.max(first, second));
}
