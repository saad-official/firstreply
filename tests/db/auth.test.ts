import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { eq } from "drizzle-orm";
import {
  ensureOrganizationForUser,
  findMembershipForUser,
  organizationNameFor,
  organizationTimezoneFor,
  slugify,
} from "@/lib/auth/organization";
import { AUTH_COOKIE_PREFIX, getAuth, resetAuthForTests, trustedOrigins } from "@/lib/auth/server";
import type { DbHandle } from "@/lib/db/client";
import { listRules } from "@/lib/db/repositories/availability";
import { account, memberships, organizations, session, user } from "@/lib/db/schema";
import { startTestDb, stopTestDb } from "./helpers";

let handle: DbHandle;

beforeAll(async () => {
  process.env.BETTER_AUTH_SECRET = "test-secret-0123456789-abcdefghijklmnopqrstuvwxyz";
  handle = await startTestDb();
  resetAuthForTests();
}, 60_000);

afterAll(async () => {
  resetAuthForTests();
  await stopTestDb(handle);
});

const WEEKDAY_9_TO_5 = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startMinute: 540, endMinute: 1020 }));

describe("Better Auth on PGlite", () => {
  it("signUpEmail creates the user and, via the hook, an org with booking slug and default availability", async () => {
    const auth = await getAuth();
    const result = await auth.api.signUpEmail({
      body: {
        name: "Northwind Studio",
        email: "owner@northwind.example",
        password: "correct horse battery",
        businessName: "Northwind Studio Ltd",
        timezone: "Europe/London",
      },
    });
    expect(result.user.email).toBe("owner@northwind.example");
    expect(result.token).toBeTruthy();

    const [stored] = await handle.db.select().from(user).where(eq(user.id, result.user.id));
    expect(stored).toMatchObject({ businessName: "Northwind Studio Ltd", timezone: "Europe/London", emailVerified: false });

    const [credential] = await handle.db.select().from(account).where(eq(account.userId, result.user.id));
    expect(credential.providerId).toBe("credential");
    expect(credential.password).toBeTruthy();
    expect(credential.password).not.toContain("correct horse");

    const rows = await handle.db
      .select({ org: organizations, role: memberships.role })
      .from(memberships)
      .innerJoin(organizations, eq(organizations.id, memberships.orgId))
      .where(eq(memberships.userId, result.user.id));
    expect(rows).toHaveLength(1);
    const { org, role } = rows[0];
    expect(role).toBe("owner");
    expect(org).toMatchObject({
      name: "Northwind Studio Ltd",
      plan: "free",
      timezone: "Europe/London",
      autonomy: "manual",
      meetingLengthMinutes: 30,
    });
    expect(org.slug).toMatch(/^northwind-studio-ltd-[a-z0-9]{6}$/);
    expect(org.bookingSlug).toBe(org.slug);

    const rules = await listRules(org.id);
    expect(rules.map(({ weekday, startMinute, endMinute }) => ({ weekday, startMinute, endMinute }))).toEqual(
      WEEKDAY_9_TO_5,
    );

    const sessions = await handle.db.select().from(session).where(eq(session.userId, result.user.id));
    expect(sessions).toHaveLength(1);
  });

  it("falls back to the email local part and UTC; booking slugs are unique per org", async () => {
    const auth = await getAuth();
    const first = await auth.api.signUpEmail({
      body: { name: "Anna", email: "anna.shop@example.com", password: "another long password", timezone: "Not/AZone" },
    });
    const second = await auth.api.signUpEmail({
      body: { name: "Anna 2", email: "anna.shop@example.org", password: "another long password" },
    });
    const a = await findMembershipForUser(handle.db, first.user.id);
    const b = await findMembershipForUser(handle.db, second.user.id);
    expect(a?.org).toMatchObject({ name: "anna.shop", timezone: "UTC" });
    expect(a?.org.slug).toMatch(/^anna-shop-[a-z0-9]{6}$/);
    expect(b?.org.name).toBe("anna.shop");
    expect(a?.org.bookingSlug).not.toBe(b?.org.bookingSlug);
    expect(await listRules(a!.org.id)).toHaveLength(5);
  });

  it("is idempotent when the repair path runs again", async () => {
    const [owner] = await handle.db.select().from(user).where(eq(user.email, "owner@northwind.example"));
    const before = await findMembershipForUser(handle.db, owner.id);
    const again = await ensureOrganizationForUser(handle.db, owner);
    expect(again.org.id).toBe(before?.org.id);
    expect(await listRules(again.org.id)).toHaveLength(5);
  });

  it("rejects short passwords and duplicate emails", async () => {
    const auth = await getAuth();
    await expect(
      auth.api.signUpEmail({ body: { name: "Short", email: "short@example.com", password: "123456789" } }),
    ).rejects.toMatchObject({ body: { code: "PASSWORD_TOO_SHORT" } });
    await expect(
      auth.api.signUpEmail({
        body: { name: "Dup", email: "owner@northwind.example", password: "correct horse battery" },
      }),
    ).rejects.toMatchObject({ body: { code: expect.stringMatching(/^USER_ALREADY_EXISTS/) } });
  });

  it("signs in with the password and resolves the session from the firstreply cookie", async () => {
    const auth = await getAuth();
    const response = await auth.api.signInEmail({
      body: { email: "owner@northwind.example", password: "correct horse battery" },
      asResponse: true,
    });
    expect(response.status).toBe(200);
    const setCookie = response.headers.getSetCookie();
    expect(setCookie.find((c) => c.startsWith("firstreply.session_token="))).toBeTruthy();

    const cookieHeader = setCookie.map((c) => c.split(";")[0]).join("; ");
    const current = await auth.api.getSession({ headers: new Headers({ cookie: cookieHeader }) });
    expect(current?.user.email).toBe("owner@northwind.example");
    expect((current?.user as { businessName?: string }).businessName).toBe("Northwind Studio Ltd");

    await expect(
      auth.api.signInEmail({ body: { email: "owner@northwind.example", password: "wrong password!!" } }),
    ).rejects.toMatchObject({ body: { code: "INVALID_EMAIL_OR_PASSWORD" } });
  });
});

describe("organization naming", () => {
  it("prefers the business name, falls back to the email local part", () => {
    expect(organizationNameFor({ email: "a@b.c", businessName: "  Boutique Verte " })).toBe("Boutique Verte");
    expect(organizationNameFor({ email: "jean.dupont@b.c", businessName: "   " })).toBe("jean.dupont");
    expect(organizationNameFor({ email: "x@b.c", businessName: 42 })).toBe("x");
  });

  it("slugifies to lower-case ASCII", () => {
    expect(slugify("Acme Security Ltd")).toBe("acme-security-ltd");
    expect(slugify("Grüner Laden GmbH")).toBe("gruner-laden-gmbh");
    expect(slugify("  Café & Co.  ")).toBe("cafe-co");
    expect(slugify("日本")).toBe("");
  });

  it("accepts only valid IANA time zones", () => {
    expect(organizationTimezoneFor({ timezone: "America/New_York" })).toBe("America/New_York");
    expect(organizationTimezoneFor({ timezone: "nope" })).toBe("UTC");
    expect(organizationTimezoneFor({})).toBe("UTC");
  });
});

describe("auth config", () => {
  it("uses the firstreply cookie prefix and trusts the app URL plus localhost", () => {
    expect(AUTH_COOKIE_PREFIX).toBe("firstreply");
    const previous = process.env.NEXT_PUBLIC_APP_URL;
    process.env.NEXT_PUBLIC_APP_URL = "https://getfirstreply.example.com/some/path";
    try {
      const origins = trustedOrigins();
      expect(origins).toEqual(
        expect.arrayContaining(["https://getfirstreply.example.com", "http://localhost:3000"]),
      );
    } finally {
      if (previous === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
      else process.env.NEXT_PUBLIC_APP_URL = previous;
    }
  });
});
