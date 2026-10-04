import "server-only";
import { and, eq } from "drizzle-orm";
import type { Db } from "../client";
import { leads, messages } from "../schema";

const URL_SAFE = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** Random url-safe id. 64 symbols, so masking a byte to 6 bits is unbiased. */
export function randomUrlSafeId(length = 12): string {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  let out = "";
  for (const byte of bytes) out += URL_SAFE[byte & 63];
  return out;
}

const SLUG_SAFE = "abcdefghijklmnopqrstuvwxyz0123456789";

/** Random lower-case alphanumeric suffix for public slugs (rejection sampling keeps it unbiased). */
export function randomSlugSuffix(length = 6): string {
  let out = "";
  while (out.length < length) {
    const bytes = new Uint8Array(length * 2);
    globalThis.crypto.getRandomValues(bytes);
    for (const byte of bytes) {
      if (byte < 252 && out.length < length) out += SLUG_SAFE[byte % 36];
    }
  }
  return out;
}

export class NotFoundError extends Error {
  constructor(what: string) {
    super(`${what} not found`);
    this.name = "NotFoundError";
  }
}

/** Throws unless the lead exists and belongs to the organization. */
export async function assertLeadInOrg(db: Db, orgId: string, leadId: string): Promise<void> {
  const [row] = await db
    .select({ id: leads.id })
    .from(leads)
    .where(and(eq(leads.id, leadId), eq(leads.orgId, orgId)))
    .limit(1);
  if (!row) throw new NotFoundError("Lead");
}

/** Throws unless the message exists and belongs to the organization. */
export async function assertMessageInOrg(db: Db, orgId: string, messageId: string): Promise<void> {
  const [row] = await db
    .select({ id: messages.id })
    .from(messages)
    .where(and(eq(messages.id, messageId), eq(messages.orgId, orgId)))
    .limit(1);
  if (!row) throw new NotFoundError("Message");
}

/** Postgres unique violation (23505), optionally on one constraint; follows `cause` chains (Drizzle wraps driver errors). */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const e = current as { code?: unknown; constraint?: unknown; constraint_name?: unknown; cause?: unknown };
    if (e.code === "23505") {
      if (!constraint) return true;
      if (e.constraint === constraint || e.constraint_name === constraint) return true;
    }
    current = e.cause;
  }
  return false;
}

export function clampLimit(limit: number | undefined, fallback = 50, max = 200): number {
  if (!limit || !Number.isFinite(limit) || limit < 1) return fallback;
  return Math.min(Math.floor(limit), max);
}

/** True for a valid IANA time zone name ("Europe/London", "UTC"). */
export function isValidTimeZone(tz: string): boolean {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Guards public lookups so a malformed id is a miss, not a Postgres cast error. */
export function isUuid(value: string | null | undefined): value is string {
  return typeof value === "string" && UUID.test(value);
}

/** A public slug (booking page, hosted form) is already used by another row. */
export class SlugTakenError extends Error {
  constructor(slug: string) {
    super(`The link "${slug}" is already taken.`);
    this.name = "SlugTakenError";
  }
}

const PUBLIC_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/;

/** Lower-case letters, digits and inner hyphens, 1-48 characters. */
export function isValidPublicSlug(slug: string): boolean {
  return PUBLIC_SLUG.test(slug) && !slug.includes("--");
}
