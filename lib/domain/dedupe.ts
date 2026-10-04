/**
 * Lead de-duplication (spec 3.1): a second message from the same person
 * within 30 days appends to the existing lead's thread.
 */
import { MS_PER_DAY } from "./dates";

export const DEDUPE_WINDOW_DAYS = 30;

/** True when a lead created at `existingCreatedAt` is less than `days` old at `now`. */
export function shouldMergeIntoExisting(existingCreatedAt: Date, now: Date, days = DEDUPE_WINDOW_DAYS): boolean {
  const elapsed = now.getTime() - existingCreatedAt.getTime();
  if (!Number.isFinite(elapsed)) return false;
  return elapsed < days * MS_PER_DAY;
}

/** Providers that deliver "local+tag@domain" to "local@domain". */
const PLUS_ADDRESSING_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "proton.me",
  "protonmail.com",
  "pm.me",
  "fastmail.com",
]);

/** Gmail also ignores dots in the local part, and googlemail.com is an alias. */
const DOT_INSENSITIVE_DOMAINS = new Set(["gmail.com", "googlemail.com"]);

/**
 * Identity key for dedupe: lower-cased, plus-tags stripped for providers known
 * to support plus addressing, dots stripped for Gmail. Company domains are left
 * as-is because their servers may treat "+" and "." literally.
 */
export function leadKey(email: string): string {
  const normalized = email.trim().toLowerCase();
  const at = normalized.lastIndexOf("@");
  if (at <= 0) return normalized;
  let local = normalized.slice(0, at);
  let domain = normalized.slice(at + 1);
  if (PLUS_ADDRESSING_DOMAINS.has(domain)) {
    const plus = local.indexOf("+");
    if (plus > 0) local = local.slice(0, plus);
  }
  if (DOT_INSENSITIVE_DOMAINS.has(domain)) {
    local = local.replace(/\./g, "");
    domain = "gmail.com";
  }
  return `${local}@${domain}`;
}
