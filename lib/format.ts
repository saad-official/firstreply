/**
 * Display formatting shared by server and client components. Pure; every
 * function takes the time zone explicitly so server renders match the
 * owner's workspace zone rather than the server's.
 */

/** Stopwatch reading: "0:42", "4:05", "1:02:10"; over a day "2d 4h". */
export function formatStopwatch(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "–";
  const s = Math.max(0, Math.round(seconds));
  if (s >= 86_400) {
    const d = Math.floor(s / 86_400);
    const h = Math.floor((s % 86_400) / 3600);
    return h > 0 ? `${d}d ${h}h` : `${d}d`;
  }
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** Compact duration for tables: "42s", "7m", "3h 5m", "2d 4h". */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "–";
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86_400) {
    const m = Math.floor((s % 3600) / 60);
    return m > 0 ? `${Math.floor(s / 3600)}h ${m}m` : `${Math.floor(s / 3600)}h`;
  }
  const h = Math.floor((s % 86_400) / 3600);
  return h > 0 ? `${Math.floor(s / 86_400)}d ${h}h` : `${Math.floor(s / 86_400)}d`;
}

export function secondsBetween(from: Date, to: Date): number {
  return Math.max(0, (to.getTime() - from.getTime()) / 1000);
}

/** "Tue 6 Oct, 14:05" in `timeZone`. */
export function formatDateTime(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

/** "6 Oct 2026" in `timeZone`. */
export function formatDate(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, day: "numeric", month: "short", year: "numeric" }).format(date);
}

/** "14:05" in `timeZone`. */
export function formatTime(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
}

/** "3 min ago", "2 h ago", "4 d ago"; "just now" under a minute. */
export function formatAgo(date: Date, now: Date): string {
  const s = secondsBetween(date, now);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86_400)} d ago`;
}

/** Minutes after midnight -> "09:30". */
export function minutesToTime(minutes: number): string {
  const m = Math.max(0, Math.min(1440, Math.round(minutes)));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** "09:30" -> 570; null when invalid. "24:00" is allowed (end of day). */
export function timeToMinutes(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (min > 59 || h > 24 || (h === 24 && min > 0)) return null;
  return h * 60 + min;
}

export function percent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "–";
  return `${Math.round(value * 100)}%`;
}
