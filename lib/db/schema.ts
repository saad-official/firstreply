/**
 * Database schema (spec section 4). Everything, including Better Auth's
 * tables, lives in the `firstreply` Postgres schema so the database can be
 * dedicated or shared with other apps. No extensions are needed
 * (gen_random_uuid() is core Postgres 13+).
 *
 * Multi-tenancy is by `org_id` plus explicit `where` clauses in
 * `lib/db/repositories/*` (no row-level security). Every tenant table carries
 * `org_id`, even when it is derivable through a parent, so each query can
 * filter on it directly.
 *
 * Conventions:
 * - Availability is stored in the org's local wall-clock time:
 *   `availability_rules.weekday` is 0 = Sunday .. 6 = Saturday (JS
 *   `Date#getDay`, date-fns `getDay`), and `start_minute` / `end_minute` are
 *   minutes after local midnight (540 = 09:00, 1020 = 17:00), interpreted in
 *   `organizations.timezone`.
 * - Lead emails are stored trimmed and lower-cased (repositories/leads.ts) so
 *   the 30-day dedupe is a plain index lookup.
 *
 * Hand-written migration (drizzle/): 0001_agent_events_append_only, a trigger
 * that rejects UPDATE, DELETE and TRUNCATE on agent_events.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const firstreply = pgSchema("firstreply");

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
const orgId = () =>
  uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" });

// ---------------------------------------------------------------------------
// Enums (value lists exported for zod schemas and UI)
// ---------------------------------------------------------------------------

export const PLANS = ["free", "pro"] as const;
export const MEMBERSHIP_ROLES = ["owner", "member"] as const;
/** manual: every outbound message waits for approval. auto_high_score: Pro auto-sends score >= 70 and confidence >= 0.8. */
export const AUTONOMY_MODES = ["manual", "auto_high_score"] as const;
export const LEAD_STATUSES = ["new", "replied", "negotiating", "booked", "declined", "spam", "archived"] as const;
export const LEAD_FITS = ["high", "medium", "low", "spam"] as const;
export const MESSAGE_DIRECTIONS = ["in", "out"] as const;
/** Outbound kinds plus `inbound` for messages received from the lead. */
export const MESSAGE_KINDS = ["reply", "decline", "counter", "question_answer", "confirmation", "inbound"] as const;
/** draft -> approved -> sent (or rejected) for outbound; `received` for inbound. */
export const MESSAGE_STATUSES = ["draft", "approved", "sent", "rejected", "received"] as const;
export const MEETING_STATUSES = ["booked", "cancelled", "no_show", "held"] as const;
export const EMAIL_PROVIDERS = ["outbox", "resend"] as const;
export const OUTBOX_STATUSES = ["queued", "sent", "delivered", "failed"] as const;
export const ACTORS = ["agent", "user", "system", "cron", "webhook"] as const;
/** How a lead arrived. `source_label` carries the detail (form name, "Typeform", ...). */
export const LEAD_SOURCES = ["form", "webhook", "email", "manual"] as const;
export const MEETING_LENGTHS = [15, 30, 45] as const;

export type LeadSource = (typeof LEAD_SOURCES)[number];

export const planEnum = firstreply.enum("plan", PLANS);
export const membershipRoleEnum = firstreply.enum("membership_role", MEMBERSHIP_ROLES);
export const autonomyEnum = firstreply.enum("autonomy", AUTONOMY_MODES);
export const leadStatusEnum = firstreply.enum("lead_status", LEAD_STATUSES);
export const leadFitEnum = firstreply.enum("lead_fit", LEAD_FITS);
export const messageDirectionEnum = firstreply.enum("message_direction", MESSAGE_DIRECTIONS);
export const messageKindEnum = firstreply.enum("message_kind", MESSAGE_KINDS);
export const messageStatusEnum = firstreply.enum("message_status", MESSAGE_STATUSES);
export const meetingStatusEnum = firstreply.enum("meeting_status", MEETING_STATUSES);
export const emailProviderEnum = firstreply.enum("email_provider", EMAIL_PROVIDERS);
export const outboxStatusEnum = firstreply.enum("outbox_status", OUTBOX_STATUSES);
export const actorEnum = firstreply.enum("actor", ACTORS);

// ---------------------------------------------------------------------------
// JSON column shapes
// ---------------------------------------------------------------------------

/** How replies should sound (organizations.voice). All optional; the drafter falls back to neutral. */
export type OrgVoice = {
  /** e.g. "warm, direct, no jargon". */
  tone?: string;
  /** Name used in the sign-off, e.g. "Sam". */
  senderName?: string;
  /** Full sign-off line(s), e.g. "Sam\nNorthwind Studio". */
  signOff?: string;
  /** Phrases or habits to avoid / prefer, free text. */
  notes?: string;
};

export type FormFieldType = "text" | "email" | "textarea" | "tel" | "url" | "select";

/** A hosted-form field (forms.fields). `name` is the key the value is stored under in leads.custom. */
export type FormField = {
  name: string;
  label: string;
  type: FormFieldType;
  required?: boolean;
  placeholder?: string;
  /** For `select`. */
  options?: string[];
};

/** Company research result (leads.enrichment). */
export type LeadEnrichment = {
  domain?: string | null;
  freeMail?: boolean;
  homepageUrl?: string | null;
  title?: string | null;
  description?: string | null;
  headings?: string[];
  excerpt?: string | null;
  summary?: string | null;
  /** Why enrichment was skipped or failed, e.g. "free-mail domain", "robots.txt". */
  error?: string | null;
  fetchedAt?: string;
};

/** Inbound reply classification (messages.classification). */
export type MessageClassification = {
  intent: "accepts_slot" | "proposes_time" | "asks_question" | "not_interested" | "out_of_office" | "other";
  /** accepts_slot: the slot offer the lead picked. */
  slotOfferId?: string | null;
  /** proposes_time / out_of_office: ISO datetime. */
  proposedAt?: string | null;
  returnDate?: string | null;
  question?: string | null;
  reason?: string | null;
  confidence?: number;
};

export type OutboxAttachment = {
  filename: string;
  contentType: string;
  /** UTF-8 text content (e.g. an ICS file). */
  content: string;
};

// ---------------------------------------------------------------------------
// Better Auth core schema (v1.7). JS keys are Better Auth's field names (the
// adapter looks columns up by them); column names are snake_case.
// ---------------------------------------------------------------------------

export const user = firstreply.table("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  /** Additional field (lib/auth/server.ts): names the organization created on sign-up. */
  businessName: text("business_name"),
  /** Additional field: the browser's IANA time zone at sign-up; seeds organizations.timezone. */
  timezone: text("timezone"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const session = firstreply.table(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .$onUpdate(() => new Date()),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [index("session_user_id_idx").on(t.userId)],
);

export const account = firstreply.table(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [index("account_user_id_idx").on(t.userId)],
);

export const verification = firstreply.table(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

// ---------------------------------------------------------------------------
// Tenancy and settings
// ---------------------------------------------------------------------------

export const organizations = firstreply.table(
  "organizations",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    plan: planEnum("plan").notNull().default("free"),
    stripeCustomerId: text("stripe_customer_id").unique(),
    stripeSubscriptionId: text("stripe_subscription_id").unique(),
    /** IANA time zone; availability rules are local to it. */
    timezone: text("timezone").notNull().default("UTC"),
    voice: jsonb("voice").$type<OrgVoice>().notNull().default({}),
    /** Plain-English ideal-customer rubric the scorer judges leads against. */
    rubric: text("rubric").notNull().default(""),
    /** What the reply offers, e.g. "A 30-minute intro call". */
    offer: text("offer").notNull().default(""),
    autonomy: autonomyEnum("autonomy").notNull().default("manual"),
    meetingLengthMinutes: integer("meeting_length_minutes").notNull().default(30),
    bufferMinutes: integer("buffer_minutes").notNull().default(10),
    minNoticeHours: integer("min_notice_hours").notNull().default(4),
    horizonBusinessDays: integer("horizon_business_days").notNull().default(10),
    /** Public booking page /b/<booking_slug>. Set at sign-up from the org slug. */
    bookingSlug: text("booking_slug").notNull().unique(),
    createdAt: createdAt(),
  },
  (t) => [
    check("organizations_meeting_length_check", sql`${t.meetingLengthMinutes} in (15, 30, 45)`),
    check("organizations_buffer_check", sql`${t.bufferMinutes} between 0 and 240`),
    check("organizations_min_notice_check", sql`${t.minNoticeHours} between 0 and 336`),
    check("organizations_horizon_check", sql`${t.horizonBusinessDays} between 1 and 60`),
  ],
);

export const memberships = firstreply.table(
  "memberships",
  {
    orgId: orgId(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: membershipRoleEnum("role").notNull().default("member"),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.userId] }), index("memberships_user_id_idx").on(t.userId)],
);

export const availabilityRules = firstreply.table(
  "availability_rules",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    orgId: orgId(),
    /** 0 = Sunday .. 6 = Saturday. */
    weekday: smallint("weekday").notNull(),
    /** Minutes after local midnight, [start_minute, end_minute). */
    startMinute: integer("start_minute").notNull(),
    endMinute: integer("end_minute").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("availability_rules_org_idx").on(t.orgId, t.weekday),
    check("availability_rules_weekday_check", sql`${t.weekday} between 0 and 6`),
    check(
      "availability_rules_minutes_check",
      sql`${t.startMinute} >= 0 and ${t.endMinute} <= 1440 and ${t.startMinute} < ${t.endMinute}`,
    ),
  ],
);

export const blackouts = firstreply.table(
  "blackouts",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    orgId: orgId(),
    /** Local calendar date in the org time zone, "YYYY-MM-DD". */
    date: date("date", { mode: "string" }).notNull(),
    reason: text("reason"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("blackouts_org_date_key").on(t.orgId, t.date)],
);

// ---------------------------------------------------------------------------
// Capture
// ---------------------------------------------------------------------------

export const forms = firstreply.table(
  "forms",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    orgId: orgId(),
    /** Public hosted form /f/<slug>. */
    slug: text("slug").notNull().unique(),
    name: text("name").notNull().default("Contact form"),
    /** Custom fields beyond the built-in name, email, company and message. */
    fields: jsonb("fields").$type<FormField[]>().notNull().default([]),
    /** Hidden input name; a non-empty value marks the submission as spam. */
    honeypotField: text("honeypot_field").notNull().default("website_url"),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("forms_org_idx").on(t.orgId)],
);

export const webhookTokens = firstreply.table(
  "webhook_tokens",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    orgId: orgId(),
    /** Secret path segment for POST /api/leads/webhook/<token>. */
    token: text("token").notNull().unique(),
    /** Where it is installed, e.g. "Typeform", "Webflow site". */
    sourceLabel: text("source_label").notNull().default("Webhook"),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("webhook_tokens_org_idx").on(t.orgId)],
);

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

export const leads = firstreply.table(
  "leads",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    orgId: orgId(),
    source: text("source").$type<LeadSource>().notNull(),
    /** Human detail for the source, e.g. the form name or webhook token label. */
    sourceLabel: text("source_label"),
    formId: uuid("form_id").references(() => forms.id, { onDelete: "set null" }),
    name: text("name"),
    /** Trimmed and lower-cased. */
    email: text("email").notNull(),
    company: text("company"),
    /** Email domain (lower-case), e.g. "northwind.example". */
    domain: text("domain"),
    message: text("message").notNull().default(""),
    /** Extra form / webhook fields. */
    custom: jsonb("custom").$type<Record<string, unknown>>().notNull().default({}),
    /** The lead's probable IANA time zone (form or email headers). */
    leadTimezone: text("lead_timezone"),
    status: leadStatusEnum("status").notNull().default("new"),
    /** 0..100, null until scored. */
    score: integer("score"),
    fit: leadFitEnum("fit"),
    scoreReasons: jsonb("score_reasons").$type<string[]>().notNull().default([]),
    enrichment: jsonb("enrichment").$type<LeadEnrichment>(),
    /** When the first outbound message was sent (median first-response time). */
    firstReplyAt: timestamp("first_reply_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("leads_org_status_created_idx").on(t.orgId, t.status, t.createdAt.desc()),
    index("leads_org_created_idx").on(t.orgId, t.createdAt.desc()),
    index("leads_org_email_created_idx").on(t.orgId, t.email, t.createdAt.desc()),
    check("leads_score_check", sql`${t.score} is null or ${t.score} between 0 and 100`),
  ],
);

export const messages = firstreply.table(
  "messages",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    orgId: orgId(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    direction: messageDirectionEnum("direction").notNull(),
    kind: messageKindEnum("kind").notNull(),
    subject: text("subject").notNull().default(""),
    body: text("body").notNull(),
    status: messageStatusEnum("status").notNull(),
    /** Drafter's self-reported confidence, 0..1. */
    confidence: real("confidence"),
    rationale: text("rationale"),
    /** Inbound only: the negotiation classifier's output. */
    classification: jsonb("classification").$type<MessageClassification>(),
    /** True for demo "Simulate reply" messages. */
    simulated: boolean("simulated").notNull().default(false),
    reviewedBy: text("reviewed_by").references(() => user.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("messages_org_status_idx").on(t.orgId, t.status, t.createdAt),
    index("messages_lead_created_idx").on(t.leadId, t.createdAt),
  ],
);

export const slotOffers = firstreply.table(
  "slot_offers",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    orgId: orgId(),
    messageId: uuid("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("slot_offers_message_idx").on(t.messageId, t.startsAt),
    index("slot_offers_org_idx").on(t.orgId),
    check("slot_offers_range_check", sql`${t.startsAt} < ${t.endsAt}`),
  ],
);

export const meetings = firstreply.table(
  "meetings",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    orgId: orgId(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    status: meetingStatusEnum("status").notNull().default("booked"),
    /** Stable iCalendar UID (confirmation and cancellation ICS share it). */
    icsUid: text("ics_uid").notNull().unique(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("meetings_org_starts_idx").on(t.orgId, t.startsAt),
    index("meetings_lead_idx").on(t.leadId),
    // Two live bookings can never start at the same instant (race guard for the booking page).
    uniqueIndex("meetings_org_starts_booked_key")
      .on(t.orgId, t.startsAt)
      .where(sql`${t.status} = 'booked'`),
    check("meetings_range_check", sql`${t.startsAt} < ${t.endsAt}`),
  ],
);

// ---------------------------------------------------------------------------
// Email and audit
// ---------------------------------------------------------------------------

export const outbox = firstreply.table(
  "outbox",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    orgId: orgId(),
    /** e.g. "lead_reply", "booking_confirmation", "weekly_report". */
    kind: text("kind"),
    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "set null" }),
    messageId: uuid("message_id").references(() => messages.id, { onDelete: "set null" }),
    toEmail: text("to_email").notNull(),
    subject: text("subject").notNull(),
    html: text("html"),
    text: text("text").notNull(),
    attachments: jsonb("attachments").$type<OutboxAttachment[]>().notNull().default([]),
    provider: emailProviderEnum("provider").notNull().default("outbox"),
    providerMessageId: text("provider_message_id"),
    /** Where the message actually went (differs from to_email in demo mode). */
    deliveredTo: text("delivered_to"),
    status: outboxStatusEnum("status").notNull().default("queued"),
    createdAt: createdAt(),
  },
  (t) => [index("outbox_org_created_idx").on(t.orgId, t.createdAt.desc())],
);

export const agentEvents = firstreply.table(
  "agent_events",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    /** null for system events not tied to an organization (e.g. cron sweeps). */
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }),
    actor: actorEnum("actor").notNull(),
    type: text("type").notNull(),
    entityType: text("entity_type"),
    entityId: uuid("entity_id"),
    input: jsonb("input"),
    output: jsonb("output"),
    model: text("model"),
    promptVersion: text("prompt_version"),
    tokensIn: integer("tokens_in"),
    tokensOut: integer("tokens_out"),
    latencyMs: integer("latency_ms"),
    createdAt: createdAt(),
  },
  (t) => [
    index("agent_events_org_created_idx").on(t.orgId, t.createdAt.desc()),
    index("agent_events_entity_idx")
      .on(t.entityType, t.entityId, t.createdAt.desc())
      .where(sql`${t.entityId} is not null`),
  ],
);
