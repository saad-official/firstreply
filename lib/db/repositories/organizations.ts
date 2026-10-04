import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "../client";
import { MEETING_LENGTHS, organizations } from "../schema";
import type { Autonomy, Organization, OrgVoice, Plan } from "../types";
import { isUniqueViolation, isValidPublicSlug, isValidTimeZone, SlugTakenError } from "./shared";

export async function getById(orgId: string): Promise<Organization | null> {
  const db = await getDb();
  const [row] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
  return row ?? null;
}

/** Public booking page lookup (/b/<slug>). Not org-scoped. */
export async function getByBookingSlug(bookingSlug: string): Promise<Organization | null> {
  const slug = bookingSlug.trim().toLowerCase();
  if (!isValidPublicSlug(slug)) return null;
  const db = await getDb();
  const [row] = await db.select().from(organizations).where(eq(organizations.bookingSlug, slug)).limit(1);
  return row ?? null;
}

export type OrganizationSettings = {
  name?: string;
  /** IANA time zone, e.g. "Europe/London". */
  timezone?: string;
  voice?: OrgVoice;
  rubric?: string;
  offer?: string;
  autonomy?: Autonomy;
  /** 15, 30 or 45. */
  meetingLengthMinutes?: number;
  bufferMinutes?: number;
  minNoticeHours?: number;
  horizonBusinessDays?: number;
  bookingSlug?: string;
};

function intInRange(value: number, min: number, max: number, label: string): number {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${label} must be a whole number between ${min} and ${max}.`);
  }
  return value;
}

/**
 * Validates and applies a partial settings update. Throws a plain Error with
 * a user-facing message on invalid input, SlugTakenError when the booking
 * slug belongs to another org.
 */
export async function updateSettings(orgId: string, patch: OrganizationSettings): Promise<Organization | null> {
  const values: Partial<typeof organizations.$inferInsert> = {};
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) throw new Error("Organization name cannot be empty.");
    values.name = name.slice(0, 120);
  }
  if (patch.timezone !== undefined) {
    if (!isValidTimeZone(patch.timezone)) throw new Error(`Unknown time zone: ${patch.timezone}`);
    values.timezone = patch.timezone;
  }
  if (patch.voice !== undefined) values.voice = patch.voice;
  if (patch.rubric !== undefined) values.rubric = patch.rubric.trim();
  if (patch.offer !== undefined) values.offer = patch.offer.trim();
  if (patch.autonomy !== undefined) values.autonomy = patch.autonomy;
  if (patch.meetingLengthMinutes !== undefined) {
    if (!(MEETING_LENGTHS as readonly number[]).includes(patch.meetingLengthMinutes)) {
      throw new Error("Meeting length must be 15, 30 or 45 minutes.");
    }
    values.meetingLengthMinutes = patch.meetingLengthMinutes;
  }
  if (patch.bufferMinutes !== undefined) {
    values.bufferMinutes = intInRange(patch.bufferMinutes, 0, 240, "Buffer");
  }
  if (patch.minNoticeHours !== undefined) {
    values.minNoticeHours = intInRange(patch.minNoticeHours, 0, 336, "Minimum notice");
  }
  if (patch.horizonBusinessDays !== undefined) {
    values.horizonBusinessDays = intInRange(patch.horizonBusinessDays, 1, 60, "Booking horizon");
  }
  if (patch.bookingSlug !== undefined) {
    const slug = patch.bookingSlug.trim().toLowerCase();
    if (!isValidPublicSlug(slug)) {
      throw new Error("Booking link: use lower-case letters, digits and hyphens (up to 48 characters).");
    }
    values.bookingSlug = slug;
  }
  if (Object.keys(values).length === 0) return getById(orgId);
  const db = await getDb();
  try {
    const [row] = await db.update(organizations).set(values).where(eq(organizations.id, orgId)).returning();
    return row ?? null;
  } catch (error) {
    if (values.bookingSlug && isUniqueViolation(error, "organizations_booking_slug_unique")) {
      throw new SlugTakenError(values.bookingSlug);
    }
    throw error;
  }
}

export type PlanChange = {
  plan: Plan;
  /** Pass null to clear; omit to leave unchanged. */
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
};

export async function setPlan(orgId: string, change: PlanChange): Promise<Organization | null> {
  const values: Partial<Organization> = { plan: change.plan };
  if (change.stripeCustomerId !== undefined) values.stripeCustomerId = change.stripeCustomerId;
  if (change.stripeSubscriptionId !== undefined) values.stripeSubscriptionId = change.stripeSubscriptionId;
  const db = await getDb();
  const [row] = await db.update(organizations).set(values).where(eq(organizations.id, orgId)).returning();
  return row ?? null;
}
