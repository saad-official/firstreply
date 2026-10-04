import "server-only";
import { asc, eq } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { DEFAULT_AVAILABILITY } from "@/lib/db/repositories/availability";
import { isUniqueViolation, isValidTimeZone, randomSlugSuffix } from "@/lib/db/repositories/shared";
import { availabilityRules, memberships, organizations } from "@/lib/db/schema";
import type { MembershipRole, Organization } from "@/lib/db/types";

/**
 * User-scoped tenancy lookups used by the auth layer. These run before an
 * org id is known, so they live here rather than in the org-scoped
 * repositories.
 */

export type Membership = { org: Organization; role: MembershipRole };

/** The user's first organization (one per user in v1). */
export async function findMembershipForUser(db: Db, userId: string): Promise<Membership | null> {
  const [row] = await db
    .select({ org: organizations, role: memberships.role })
    .from(memberships)
    .innerJoin(organizations, eq(organizations.id, memberships.orgId))
    .where(eq(memberships.userId, userId))
    .orderBy(asc(memberships.createdAt))
    .limit(1);
  return row ?? null;
}

export function organizationNameFor(user: { email: string; businessName?: unknown }): string {
  const business = typeof user.businessName === "string" ? user.businessName.trim() : "";
  if (business) return business.slice(0, 120);
  const local = user.email.split("@")[0]?.trim();
  return local || "My company";
}

/** Lower-case ASCII slug; "" when nothing usable remains. */
export function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

function slugCandidate(name: string): string {
  return `${slugify(name) || "org"}-${randomSlugSuffix(6)}`;
}

/** The sign-up time zone when it is a valid IANA name, else UTC. */
export function organizationTimezoneFor(user: { timezone?: unknown }): string {
  const tz = typeof user.timezone === "string" ? user.timezone.trim() : "";
  return tz && isValidTimeZone(tz) ? tz : "UTC";
}

type SignUpUser = { id: string; email: string; businessName?: unknown; timezone?: unknown };

/**
 * Creates the user's organization, owner membership and default weekly
 * availability (Mon-Fri 09:00-17:00 in the org time zone), once, in one
 * transaction. The booking page slug starts out equal to the org slug.
 * Called from Better Auth's `databaseHooks.user.create.after`, and again (as
 * a repair) by `getOrgContext` if that hook ever failed. The slug gets a
 * random suffix and is retried on the (unlikely) unique collision.
 */
export async function ensureOrganizationForUser(db: Db, user: SignUpUser): Promise<Membership> {
  const existing = await findMembershipForUser(db, user.id);
  if (existing) return existing;

  const name = organizationNameFor(user);
  const timezone = organizationTimezoneFor(user);
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.transaction(async (tx) => {
        const slug = slugCandidate(name);
        const [org] = await tx
          .insert(organizations)
          .values({ name, slug, bookingSlug: slug, timezone })
          .returning();
        await tx.insert(memberships).values({ orgId: org.id, userId: user.id, role: "owner" });
        await tx.insert(availabilityRules).values(DEFAULT_AVAILABILITY.map((rule) => ({ orgId: org.id, ...rule })));
        return { org, role: "owner" as const };
      });
    } catch (error) {
      const slugClash =
        isUniqueViolation(error, "organizations_slug_unique") ||
        isUniqueViolation(error, "organizations_booking_slug_unique");
      if (attempt < 3 && slugClash) continue;
      // A concurrent bootstrap for the same user may have won; use its result.
      const raced = await findMembershipForUser(db, user.id);
      if (raced) return raced;
      throw error;
    }
  }
}
