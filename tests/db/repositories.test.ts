import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/pglite/migrator";
import { logAgentEvent } from "@/lib/ai/log";
import { MIGRATIONS_CONFIG, migrationsFolder, type DbHandle } from "@/lib/db/client";
import * as availabilityRepo from "@/lib/db/repositories/availability";
import { findOrgForStripe } from "@/lib/db/repositories/billing";
import * as formsRepo from "@/lib/db/repositories/forms";
import * as leadsRepo from "@/lib/db/repositories/leads";
import * as meetingsRepo from "@/lib/db/repositories/meetings";
import * as messagesRepo from "@/lib/db/repositories/messages";
import * as metricsRepo from "@/lib/db/repositories/metrics";
import * as organizationsRepo from "@/lib/db/repositories/organizations";
import * as outboxRepo from "@/lib/db/repositories/outbox";
import { NotFoundError, SlugTakenError } from "@/lib/db/repositories/shared";
import * as slotOffersRepo from "@/lib/db/repositories/slotOffers";
import * as webhookTokensRepo from "@/lib/db/repositories/webhookTokens";
import { agentEvents, organizations } from "@/lib/db/schema";
import { dbErrorMessage, insertOrg, queryRows, startTestDb, stopTestDb } from "./helpers";

let handle: DbHandle;

beforeAll(async () => {
  handle = await startTestDb();
}, 120_000);

afterAll(async () => {
  await stopTestDb(handle);
});

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("migrations", () => {
  it("creates every table in the firstreply schema and nothing in public", async () => {
    const rows = await queryRows<{ table_schema: string; table_name: string }>(
      handle,
      sql`select table_schema, table_name from information_schema.tables
          where table_schema in ('firstreply', 'public', 'drizzle') order by table_name`,
    );
    expect(rows.every((r) => r.table_schema === "firstreply")).toBe(true);
    expect(rows.map((r) => r.table_name).sort()).toEqual(
      [
        "__drizzle_migrations",
        "account",
        "agent_events",
        "availability_rules",
        "blackouts",
        "forms",
        "leads",
        "meetings",
        "memberships",
        "messages",
        "organizations",
        "outbox",
        "session",
        "slot_offers",
        "user",
        "verification",
        "webhook_tokens",
      ].sort(),
    );
  });

  it("builds the hot-path indexes and needs no extensions", async () => {
    const indexes = await queryRows<{ indexname: string }>(
      handle,
      sql`select indexname from pg_indexes where schemaname = 'firstreply'`,
    );
    expect(indexes.map((i) => i.indexname)).toEqual(
      expect.arrayContaining([
        "leads_org_status_created_idx",
        "leads_org_email_created_idx",
        "messages_org_status_idx",
        "meetings_org_starts_idx",
        "meetings_org_starts_booked_key",
        "availability_rules_org_idx",
      ]),
    );
    const ext = await queryRows<{ extname: string }>(handle, sql`select extname from pg_extension where extname <> 'plpgsql'`);
    expect(ext).toEqual([]);
  });

  it("is idempotent", async () => {
    await expect(
      migrate(handle.db as never, { migrationsFolder: migrationsFolder(), ...MIGRATIONS_CONFIG }),
    ).resolves.toBeUndefined();
  });
});

describe("organizations", () => {
  it("applies settings with validation and looks up by booking slug", async () => {
    const org = await insertOrg(handle);
    expect(org).toMatchObject({
      timezone: "UTC",
      autonomy: "manual",
      meetingLengthMinutes: 30,
      bufferMinutes: 10,
      minNoticeHours: 4,
      horizonBusinessDays: 10,
      voice: {},
      rubric: "",
    });

    const updated = await organizationsRepo.updateSettings(org.id, {
      name: "  Northwind Studio ",
      timezone: "Europe/London",
      voice: { tone: "warm, direct", senderName: "Sam" },
      rubric: "B2B SaaS 10-200 people in UK/EU",
      offer: "A 20-minute intro call",
      autonomy: "auto_high_score",
      meetingLengthMinutes: 45,
      bufferMinutes: 15,
      bookingSlug: "Northwind",
    });
    expect(updated).toMatchObject({
      name: "Northwind Studio",
      timezone: "Europe/London",
      voice: { tone: "warm, direct", senderName: "Sam" },
      autonomy: "auto_high_score",
      meetingLengthMinutes: 45,
      bookingSlug: "northwind",
    });
    expect((await organizationsRepo.getByBookingSlug("northwind"))?.id).toBe(org.id);
    expect(await organizationsRepo.getByBookingSlug("no such slug!")).toBeNull();

    await expect(organizationsRepo.updateSettings(org.id, { timezone: "Mars/Olympus" })).rejects.toThrow(/time zone/);
    await expect(organizationsRepo.updateSettings(org.id, { meetingLengthMinutes: 20 })).rejects.toThrow(/15, 30 or 45/);
    const other = await insertOrg(handle);
    await expect(organizationsRepo.updateSettings(other.id, { bookingSlug: "northwind" })).rejects.toBeInstanceOf(
      SlugTakenError,
    );
  });

  it("sets the plan and finds the org for Stripe", async () => {
    const org = await insertOrg(handle);
    const pro = await organizationsRepo.setPlan(org.id, { plan: "pro", stripeCustomerId: "cus_fr_1" });
    expect(pro).toMatchObject({ plan: "pro", stripeCustomerId: "cus_fr_1", stripeSubscriptionId: null });
    expect((await findOrgForStripe({ customerId: "cus_fr_1" }))?.id).toBe(org.id);
    expect((await findOrgForStripe({ orgId: "not-a-uuid", customerId: "cus_fr_1" }))?.id).toBe(org.id);
    expect(await findOrgForStripe({ subscriptionId: "sub_missing" })).toBeNull();
  });
});

describe("availability", () => {
  it("replaces rules atomically and rejects overlaps", async () => {
    const org = await insertOrg(handle);
    const rules = await availabilityRepo.replaceRules(org.id, [
      { weekday: 3, startMinute: 13 * 60, endMinute: 17 * 60 },
      { weekday: 3, startMinute: 9 * 60, endMinute: 12 * 60 },
      { weekday: 1, startMinute: 9 * 60, endMinute: 17 * 60 },
    ]);
    expect(rules.map((r) => [r.weekday, r.startMinute])).toEqual([
      [1, 540],
      [3, 540],
      [3, 780],
    ]);
    await expect(
      availabilityRepo.replaceRules(org.id, [
        { weekday: 2, startMinute: 540, endMinute: 720 },
        { weekday: 2, startMinute: 700, endMinute: 800 },
      ]),
    ).rejects.toThrow(/overlap/);
    await expect(availabilityRepo.replaceRules(org.id, [{ weekday: 7, startMinute: 0, endMinute: 60 }])).rejects.toThrow(
      /Weekday/,
    );
    // The failed replacements left the schedule untouched.
    expect(await availabilityRepo.listRules(org.id)).toHaveLength(3);
    expect(await availabilityRepo.replaceRules(org.id, [])).toEqual([]);
    expect(await availabilityRepo.listRules(org.id)).toEqual([]);
  });

  it("adds, lists and removes blackout dates", async () => {
    const org = await insertOrg(handle);
    const xmas = await availabilityRepo.addBlackout(org.id, "2026-12-25", "Holiday");
    await availabilityRepo.addBlackout(org.id, "2026-12-24");
    const again = await availabilityRepo.addBlackout(org.id, "2026-12-25", "Christmas");
    expect(again.id).toBe(xmas.id);
    expect(again.reason).toBe("Christmas");
    expect((await availabilityRepo.listBlackouts(org.id)).map((b) => b.date)).toEqual(["2026-12-24", "2026-12-25"]);
    expect(
      (await availabilityRepo.listBlackouts(org.id, { from: "2026-12-25", to: "2026-12-31" })).map((b) => b.date),
    ).toEqual(["2026-12-25"]);
    await expect(availabilityRepo.addBlackout(org.id, "2026-02-30")).rejects.toThrow(/Invalid date/);
    const otherOrg = await insertOrg(handle);
    expect(await availabilityRepo.removeBlackout(otherOrg.id, xmas.id)).toBe(false);
    expect(await availabilityRepo.removeBlackout(org.id, xmas.id)).toBe(true);
    expect(await availabilityRepo.listBlackouts(org.id)).toHaveLength(1);
  });
});

describe("forms and webhook tokens", () => {
  it("creates forms with unique public slugs and finds active ones", async () => {
    const org = await insertOrg(handle);
    const form = await formsRepo.create(org.id, {
      slugBase: "Northwind",
      fields: [{ name: "budget", label: "Budget", type: "select", options: ["<5k", "5k+"] }],
    });
    expect(form.slug).toMatch(/^northwind-[a-z0-9]{6}$/);
    expect(form).toMatchObject({ name: "Contact form", honeypotField: "website_url", active: true });
    expect((await formsRepo.getBySlug(form.slug))?.id).toBe(form.id);

    await formsRepo.create(org.id, { slug: "northwind-contact" });
    await expect(formsRepo.create(org.id, { slug: "northwind-contact" })).rejects.toBeInstanceOf(SlugTakenError);
    await expect(
      formsRepo.create(org.id, { fields: [{ name: "email", label: "Email again", type: "email" }] }),
    ).rejects.toThrow(/Duplicate/);

    const paused = await formsRepo.update(org.id, form.id, { active: false, name: "Paused" });
    expect(paused).toMatchObject({ active: false, name: "Paused" });
    expect(await formsRepo.getBySlug(form.slug)).toBeNull();
    expect(await formsRepo.listForOrg(org.id)).toHaveLength(2);
    expect(await formsRepo.update((await insertOrg(handle)).id, form.id, { active: true })).toBeNull();
  });

  it("issues, resolves and revokes webhook tokens", async () => {
    const org = await insertOrg(handle);
    const token = await webhookTokensRepo.create(org.id, { sourceLabel: "Typeform" });
    expect(token.token).toHaveLength(32);
    const now = new Date("2026-10-04T10:00:00Z");
    const found = await webhookTokensRepo.getByToken(token.token, { now });
    expect(found).toMatchObject({ orgId: org.id, sourceLabel: "Typeform", lastUsedAt: now });
    expect(await webhookTokensRepo.listForOrg(org.id)).toHaveLength(1);
    expect(await webhookTokensRepo.revoke(org.id, token.id)).toBe(true);
    expect(await webhookTokensRepo.revoke(org.id, token.id)).toBe(false);
    expect(await webhookTokensRepo.getByToken(token.token)).toBeNull();
  });
});

describe("leads", () => {
  it("dedupes by email within the window, case-insensitively and per org", async () => {
    const org = await insertOrg(handle);
    const now = new Date("2026-10-04T12:00:00Z");
    const old = await leadsRepo.create(org.id, {
      source: "form",
      email: "ada@northwind.example",
      message: "Hello from last quarter",
      createdAt: new Date(now.getTime() - 45 * DAY),
    });
    const recent = await leadsRepo.create(org.id, {
      source: "webhook",
      name: " Ada Lovelace ",
      email: "  Ada@Northwind.EXAMPLE ",
      message: "We need help with onboarding",
      createdAt: new Date(now.getTime() - 3 * DAY),
    });
    expect(recent).toMatchObject({ email: "ada@northwind.example", domain: "northwind.example", name: "Ada Lovelace", status: "new" });

    const match = await leadsRepo.findRecentByEmail(org.id, "ADA@northwind.example", 30, now);
    expect(match?.id).toBe(recent.id);
    expect((await leadsRepo.findRecentByEmail(org.id, "ada@northwind.example", 60, now))?.id).toBe(recent.id);
    expect(await leadsRepo.findRecentByEmail(org.id, "ada@northwind.example", 2, now)).toBeNull();
    expect(await leadsRepo.findRecentByEmail(org.id, "bob@northwind.example", 30, now)).toBeNull();
    const otherOrg = await insertOrg(handle);
    expect(await leadsRepo.findRecentByEmail(otherOrg.id, "ada@northwind.example", 30, now)).toBeNull();
    expect(old.id).not.toBe(recent.id);
  });

  it("lists with a status filter and updates score, enrichment, status and first reply", async () => {
    const org = await insertOrg(handle);
    const a = await leadsRepo.create(org.id, { source: "form", email: "a@one.example" });
    const b = await leadsRepo.create(org.id, { source: "form", email: "b@two.example", status: "spam" });
    await leadsRepo.create(org.id, { source: "email", email: "c@three.example" });

    expect((await leadsRepo.listForOrg(org.id)).length).toBe(3);
    expect((await leadsRepo.listForOrg(org.id, { status: "spam" })).map((l) => l.id)).toEqual([b.id]);
    expect(await leadsRepo.listForOrg(org.id, { status: ["new", "replied"] })).toHaveLength(2);

    const scored = await leadsRepo.updateScore(org.id, a.id, { score: 104.4, fit: "high", reasons: ["B2B SaaS"] });
    expect(scored).toMatchObject({ score: 100, fit: "high", scoreReasons: ["B2B SaaS"] });
    const enriched = await leadsRepo.updateEnrichment(
      org.id,
      a.id,
      { title: "One", summary: "Makes widgets", freeMail: false },
      { company: "One Ltd" },
    );
    expect(enriched).toMatchObject({ company: "One Ltd", enrichment: { title: "One", summary: "Makes widgets" } });
    expect((await leadsRepo.updateStatus(org.id, a.id, "replied"))?.status).toBe("replied");

    const first = new Date("2026-10-04T12:00:30Z");
    expect(await leadsRepo.setFirstReplyAt(org.id, a.id, first)).toBe(true);
    expect(await leadsRepo.setFirstReplyAt(org.id, a.id, new Date())).toBe(false);
    expect((await leadsRepo.getById(org.id, a.id))?.firstReplyAt).toEqual(first);

    const otherOrg = await insertOrg(handle);
    expect(await leadsRepo.getById(otherOrg.id, a.id)).toBeNull();
    expect(await leadsRepo.updateStatus(otherOrg.id, a.id, "archived")).toBeNull();
    expect(await leadsRepo.countCreatedSince(org.id, new Date(Date.now() - HOUR))).toBe(3);
    expect(await leadsRepo.countCreatedSince(org.id, new Date(Date.now() + HOUR))).toBe(0);
  });
});

describe("messages and the approval queue", () => {
  it("lists outbound drafts oldest first with their lead, and moves them through approval", async () => {
    const org = await insertOrg(handle);
    const t0 = new Date("2026-10-04T09:00:00Z");
    const ada = await leadsRepo.create(org.id, { source: "form", name: "Ada", email: "ada@one.example" });
    const bob = await leadsRepo.create(org.id, { source: "form", name: "Bob", email: "bob@two.example" });

    await messagesRepo.create(org.id, { leadId: ada.id, direction: "in", body: "Can we talk?", createdAt: t0 });
    const later = await messagesRepo.create(org.id, {
      leadId: ada.id,
      direction: "out",
      kind: "reply",
      subject: "Re: Can we talk?",
      body: "Hi Ada, ...",
      confidence: 0.9,
      createdAt: new Date(t0.getTime() + 2 * MINUTE),
    });
    const earlier = await messagesRepo.create(org.id, {
      leadId: bob.id,
      direction: "out",
      kind: "decline",
      body: "Hi Bob, ...",
      createdAt: new Date(t0.getTime() + MINUTE),
    });
    const sent = await messagesRepo.create(org.id, { leadId: bob.id, direction: "out", body: "Sent", status: "sent" });

    const queue = await messagesRepo.listQueue(org.id);
    expect(queue.map((q) => q.message.id)).toEqual([earlier.id, later.id]);
    expect(queue[0].lead).toMatchObject({ id: bob.id, name: "Bob", email: "bob@two.example" });
    expect(await messagesRepo.countAwaitingApproval(org.id)).toBe(2);
    const otherOrg = await insertOrg(handle);
    expect(await messagesRepo.listQueue(otherOrg.id)).toEqual([]);
    expect(await messagesRepo.countAwaitingApproval(otherOrg.id)).toBe(0);

    const approved = await messagesRepo.approve(org.id, later.id, { body: "Hi Ada, edited" });
    expect(approved).toMatchObject({ status: "approved", body: "Hi Ada, edited" });
    expect(approved?.reviewedAt).toBeInstanceOf(Date);
    expect(await messagesRepo.approve(org.id, later.id)).toBeNull();
    const delivered = await messagesRepo.markSent(org.id, later.id, new Date("2026-10-04T09:05:00Z"));
    expect(delivered).toMatchObject({ status: "sent" });
    expect(await messagesRepo.markSent(org.id, later.id)).toBeNull();
    expect(await messagesRepo.markSent(org.id, sent.id)).toBeNull();

    expect((await messagesRepo.reject(org.id, earlier.id))?.status).toBe("rejected");
    expect(await messagesRepo.countAwaitingApproval(org.id)).toBe(0);
    expect((await messagesRepo.listForLead(org.id, ada.id)).map((m) => m.direction)).toEqual(["in", "out"]);
  });

  it("rejects inconsistent direction, kind and status, and foreign leads", async () => {
    const org = await insertOrg(handle);
    const lead = await leadsRepo.create(org.id, { source: "form", email: "x@y.example" });
    await expect(messagesRepo.create(org.id, { leadId: lead.id, direction: "in", kind: "reply", body: "x" })).rejects.toThrow(
      /does not match/,
    );
    await expect(
      messagesRepo.create(org.id, { leadId: lead.id, direction: "out", status: "received", body: "x" }),
    ).rejects.toThrow(/does not match/);
    const otherOrg = await insertOrg(handle);
    await expect(messagesRepo.create(otherOrg.id, { leadId: lead.id, direction: "out", body: "x" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("stores slot offers for a message, earliest first", async () => {
    const org = await insertOrg(handle);
    const lead = await leadsRepo.create(org.id, { source: "form", email: "s@lots.example" });
    const message = await messagesRepo.create(org.id, { leadId: lead.id, direction: "out", body: "Pick one" });
    const base = new Date("2026-10-06T09:00:00Z").getTime();
    const offers = await slotOffersRepo.createMany(org.id, message.id, [
      { startsAt: new Date(base + 2 * DAY), endsAt: new Date(base + 2 * DAY + 30 * MINUTE) },
      { startsAt: new Date(base), endsAt: new Date(base + 30 * MINUTE) },
      { startsAt: new Date(base + DAY + 5 * HOUR), endsAt: new Date(base + DAY + 5 * HOUR + 30 * MINUTE) },
    ]);
    expect(offers).toHaveLength(3);
    const listed = await slotOffersRepo.listForMessage(org.id, message.id);
    expect(listed.map((o) => o.startsAt.getTime())).toEqual([base, base + DAY + 5 * HOUR, base + 2 * DAY]);
    expect((await slotOffersRepo.getById(org.id, listed[0].id))?.messageId).toBe(message.id);
    const otherOrg = await insertOrg(handle);
    expect(await slotOffersRepo.listForMessage(otherOrg.id, message.id)).toEqual([]);
  });
});

describe("meetings and busy time", () => {
  it("lists non-cancelled meetings overlapping a window and refuses double bookings", async () => {
    const org = await insertOrg(handle);
    const lead = await leadsRepo.create(org.id, { source: "form", email: "m@meet.example" });
    const at = (iso: string) => new Date(iso);

    const m1 = await meetingsRepo.create(org.id, {
      leadId: lead.id,
      startsAt: at("2026-10-06T09:00:00Z"),
      endsAt: at("2026-10-06T09:30:00Z"),
    });
    expect(m1.icsUid).toMatch(/@firstreply$/);
    const m2 = await meetingsRepo.create(org.id, {
      leadId: lead.id,
      startsAt: at("2026-10-06T14:00:00Z"),
      endsAt: at("2026-10-06T14:30:00Z"),
      icsUid: "fixed-uid@firstreply",
    });
    await meetingsRepo.create(org.id, {
      leadId: lead.id,
      startsAt: at("2026-10-08T10:00:00Z"),
      endsAt: at("2026-10-08T10:45:00Z"),
    });

    // Overlap (not just identical starts) is refused.
    await expect(
      meetingsRepo.create(org.id, { leadId: lead.id, startsAt: at("2026-10-06T09:15:00Z"), endsAt: at("2026-10-06T09:45:00Z") }),
    ).rejects.toBeInstanceOf(meetingsRepo.SlotUnavailableError);

    // Busy window: touching at the edges does not count as overlap.
    const busy = await meetingsRepo.listBusy(org.id, at("2026-10-06T09:30:00Z"), at("2026-10-07T00:00:00Z"));
    expect(busy).toEqual([{ startsAt: at("2026-10-06T14:00:00Z"), endsAt: at("2026-10-06T14:30:00Z") }]);
    const wide = await meetingsRepo.listBusy(org.id, at("2026-10-06T00:00:00Z"), at("2026-10-09T00:00:00Z"));
    expect(wide).toHaveLength(3);

    // Cancelling frees the slot, and it can be booked again.
    expect((await meetingsRepo.updateStatus(org.id, m1.id, "cancelled"))?.status).toBe("cancelled");
    expect(await meetingsRepo.listBusy(org.id, at("2026-10-06T00:00:00Z"), at("2026-10-06T12:00:00Z"))).toEqual([]);
    const rebooked = await meetingsRepo.create(org.id, {
      leadId: lead.id,
      startsAt: at("2026-10-06T09:00:00Z"),
      endsAt: at("2026-10-06T09:30:00Z"),
    });
    expect(rebooked.status).toBe("booked");

    // Other orgs' meetings never show up as busy.
    const otherOrg = await insertOrg(handle);
    expect(await meetingsRepo.listBusy(otherOrg.id, at("2026-10-01T00:00:00Z"), at("2026-10-31T00:00:00Z"))).toEqual([]);

    expect((await meetingsRepo.getByIcsUid("fixed-uid@firstreply"))?.id).toBe(m2.id);
    expect(await meetingsRepo.getByIcsUid("fixed-uid@firstreply", otherOrg.id)).toBeNull();
    const listed = await meetingsRepo.listForOrg(org.id, { status: "booked" });
    expect(listed.map((m) => m.startsAt.toISOString())).toEqual([
      "2026-10-06T09:00:00.000Z",
      "2026-10-06T14:00:00.000Z",
      "2026-10-08T10:00:00.000Z",
    ]);
  });
});

describe("metrics", () => {
  it("computes the median first-response time and counts by status", async () => {
    const org = await insertOrg(handle);
    const since = new Date(Date.now() - DAY);
    const created = new Date(Date.now() - HOUR);
    const delays = [30, 50, 600];
    for (const [i, seconds] of delays.entries()) {
      const lead = await leadsRepo.create(org.id, { source: "form", email: `l${i}@m.example`, createdAt: created });
      await leadsRepo.setFirstReplyAt(org.id, lead.id, new Date(created.getTime() + seconds * 1000));
      await leadsRepo.updateStatus(org.id, lead.id, "replied");
    }
    await leadsRepo.create(org.id, { source: "form", email: "unanswered@m.example", createdAt: created });
    expect(await metricsRepo.medianFirstResponseSeconds(org.id, since)).toBeCloseTo(50, 3);
    expect(await metricsRepo.medianFirstResponseSeconds(org.id, new Date())).toBeNull();

    const counts = await metricsRepo.countsByStatus(org.id);
    expect(counts).toMatchObject({ new: 1, replied: 3, booked: 0, spam: 0 });
    expect(Object.keys(counts)).toHaveLength(7);
  });
});

describe("outbox", () => {
  it("stores messages with attachments, newest first", async () => {
    const org = await insertOrg(handle);
    const lead = await leadsRepo.create(org.id, { source: "form", email: "o@box.example" });
    await outboxRepo.insert(org.id, { toEmail: "o@box.example", subject: "First", text: "1", kind: "lead_reply" });
    await outboxRepo.insert(org.id, {
      toEmail: "o@box.example",
      subject: "Booked",
      text: "2",
      kind: "booking_confirmation",
      leadId: lead.id,
      attachments: [{ filename: "invite.ics", contentType: "text/calendar", content: "BEGIN:VCALENDAR" }],
    });
    const all = await outboxRepo.listForOrg(org.id);
    expect(all.map((m) => m.subject)).toEqual(["Booked", "First"]);
    expect(all[0].attachments[0].filename).toBe("invite.ics");
    expect(await outboxRepo.listForOrg(org.id, { leadId: lead.id })).toHaveLength(1);
  });
});

describe("agent_events", () => {
  it("is append-only: insert works, update/delete/truncate are rejected", async () => {
    const org = await insertOrg(handle);
    await logAgentEvent(handle.db, {
      orgId: org.id,
      actor: "agent",
      type: "lead.scored",
      entityType: "lead",
      input: { leadId: "x" },
      meta: { model: "fake", promptVersion: "v1", tokensIn: 10, tokensOut: 5, latencyMs: 12, attempts: 1 },
    });
    await logAgentEvent(handle.db, { orgId: null, actor: "cron", type: "cron.daily" });
    const rows = await handle.db.select().from(agentEvents).where(eq(agentEvents.orgId, org.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ model: "fake", promptVersion: "v1", tokensIn: 10, tokensOut: 5, latencyMs: 12 });

    expect(await dbErrorMessage(handle.db.update(agentEvents).set({ type: "tampered" }))).toMatch(/append-only/);
    expect(await dbErrorMessage(handle.db.delete(agentEvents))).toMatch(/append-only/);
    expect(await dbErrorMessage(handle.db.execute(sql`truncate firstreply.agent_events`))).toMatch(/append-only/);

    // Deleting the whole organization cascades through the trigger.
    await handle.db.delete(organizations).where(eq(organizations.id, org.id));
    expect(await handle.db.select().from(agentEvents).where(eq(agentEvents.orgId, org.id))).toEqual([]);
  });
});
