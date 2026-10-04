CREATE SCHEMA IF NOT EXISTS "firstreply";
--> statement-breakpoint
CREATE TYPE "firstreply"."actor" AS ENUM('agent', 'user', 'system', 'cron', 'webhook');--> statement-breakpoint
CREATE TYPE "firstreply"."autonomy" AS ENUM('manual', 'auto_high_score');--> statement-breakpoint
CREATE TYPE "firstreply"."email_provider" AS ENUM('outbox', 'resend');--> statement-breakpoint
CREATE TYPE "firstreply"."lead_fit" AS ENUM('high', 'medium', 'low', 'spam');--> statement-breakpoint
CREATE TYPE "firstreply"."lead_status" AS ENUM('new', 'replied', 'negotiating', 'booked', 'declined', 'spam', 'archived');--> statement-breakpoint
CREATE TYPE "firstreply"."meeting_status" AS ENUM('booked', 'cancelled', 'no_show', 'held');--> statement-breakpoint
CREATE TYPE "firstreply"."membership_role" AS ENUM('owner', 'member');--> statement-breakpoint
CREATE TYPE "firstreply"."message_direction" AS ENUM('in', 'out');--> statement-breakpoint
CREATE TYPE "firstreply"."message_kind" AS ENUM('reply', 'decline', 'counter', 'question_answer', 'confirmation', 'inbound');--> statement-breakpoint
CREATE TYPE "firstreply"."message_status" AS ENUM('draft', 'approved', 'sent', 'rejected', 'received');--> statement-breakpoint
CREATE TYPE "firstreply"."outbox_status" AS ENUM('queued', 'sent', 'delivered', 'failed');--> statement-breakpoint
CREATE TYPE "firstreply"."plan" AS ENUM('free', 'pro');--> statement-breakpoint
CREATE TABLE "firstreply"."account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "firstreply"."agent_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid,
	"actor" "firstreply"."actor" NOT NULL,
	"type" text NOT NULL,
	"entity_type" text,
	"entity_id" uuid,
	"input" jsonb,
	"output" jsonb,
	"model" text,
	"prompt_version" text,
	"tokens_in" integer,
	"tokens_out" integer,
	"latency_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "firstreply"."availability_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"weekday" smallint NOT NULL,
	"start_minute" integer NOT NULL,
	"end_minute" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "availability_rules_weekday_check" CHECK ("firstreply"."availability_rules"."weekday" between 0 and 6),
	CONSTRAINT "availability_rules_minutes_check" CHECK ("firstreply"."availability_rules"."start_minute" >= 0 and "firstreply"."availability_rules"."end_minute" <= 1440 and "firstreply"."availability_rules"."start_minute" < "firstreply"."availability_rules"."end_minute")
);
--> statement-breakpoint
CREATE TABLE "firstreply"."blackouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"date" date NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "firstreply"."forms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text DEFAULT 'Contact form' NOT NULL,
	"fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"honeypot_field" text DEFAULT 'website_url' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "forms_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "firstreply"."leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"source" text NOT NULL,
	"source_label" text,
	"form_id" uuid,
	"name" text,
	"email" text NOT NULL,
	"company" text,
	"domain" text,
	"message" text DEFAULT '' NOT NULL,
	"custom" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"lead_timezone" text,
	"status" "firstreply"."lead_status" DEFAULT 'new' NOT NULL,
	"score" integer,
	"fit" "firstreply"."lead_fit",
	"score_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"enrichment" jsonb,
	"first_reply_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leads_score_check" CHECK ("firstreply"."leads"."score" is null or "firstreply"."leads"."score" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "firstreply"."meetings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" "firstreply"."meeting_status" DEFAULT 'booked' NOT NULL,
	"ics_uid" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meetings_ics_uid_unique" UNIQUE("ics_uid"),
	CONSTRAINT "meetings_range_check" CHECK ("firstreply"."meetings"."starts_at" < "firstreply"."meetings"."ends_at")
);
--> statement-breakpoint
CREATE TABLE "firstreply"."memberships" (
	"org_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" "firstreply"."membership_role" DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_org_id_user_id_pk" PRIMARY KEY("org_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "firstreply"."messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"direction" "firstreply"."message_direction" NOT NULL,
	"kind" "firstreply"."message_kind" NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"body" text NOT NULL,
	"status" "firstreply"."message_status" NOT NULL,
	"confidence" real,
	"rationale" text,
	"classification" jsonb,
	"simulated" boolean DEFAULT false NOT NULL,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "firstreply"."organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"plan" "firstreply"."plan" DEFAULT 'free' NOT NULL,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"voice" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"rubric" text DEFAULT '' NOT NULL,
	"offer" text DEFAULT '' NOT NULL,
	"autonomy" "firstreply"."autonomy" DEFAULT 'manual' NOT NULL,
	"meeting_length_minutes" integer DEFAULT 30 NOT NULL,
	"buffer_minutes" integer DEFAULT 10 NOT NULL,
	"min_notice_hours" integer DEFAULT 4 NOT NULL,
	"horizon_business_days" integer DEFAULT 10 NOT NULL,
	"booking_slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug"),
	CONSTRAINT "organizations_stripe_customer_id_unique" UNIQUE("stripe_customer_id"),
	CONSTRAINT "organizations_stripe_subscription_id_unique" UNIQUE("stripe_subscription_id"),
	CONSTRAINT "organizations_booking_slug_unique" UNIQUE("booking_slug"),
	CONSTRAINT "organizations_meeting_length_check" CHECK ("firstreply"."organizations"."meeting_length_minutes" in (15, 30, 45)),
	CONSTRAINT "organizations_buffer_check" CHECK ("firstreply"."organizations"."buffer_minutes" between 0 and 240),
	CONSTRAINT "organizations_min_notice_check" CHECK ("firstreply"."organizations"."min_notice_hours" between 0 and 336),
	CONSTRAINT "organizations_horizon_check" CHECK ("firstreply"."organizations"."horizon_business_days" between 1 and 60)
);
--> statement-breakpoint
CREATE TABLE "firstreply"."outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"kind" text,
	"lead_id" uuid,
	"message_id" uuid,
	"to_email" text NOT NULL,
	"subject" text NOT NULL,
	"html" text,
	"text" text NOT NULL,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"provider" "firstreply"."email_provider" DEFAULT 'outbox' NOT NULL,
	"provider_message_id" text,
	"delivered_to" text,
	"status" "firstreply"."outbox_status" DEFAULT 'queued' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "firstreply"."session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "firstreply"."slot_offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "slot_offers_range_check" CHECK ("firstreply"."slot_offers"."starts_at" < "firstreply"."slot_offers"."ends_at")
);
--> statement-breakpoint
CREATE TABLE "firstreply"."user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"business_name" text,
	"timezone" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "firstreply"."verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "firstreply"."webhook_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"token" text NOT NULL,
	"source_label" text DEFAULT 'Webhook' NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "firstreply"."account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "firstreply"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "firstreply"."agent_events" ADD CONSTRAINT "agent_events_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "firstreply"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "firstreply"."availability_rules" ADD CONSTRAINT "availability_rules_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "firstreply"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "firstreply"."blackouts" ADD CONSTRAINT "blackouts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "firstreply"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "firstreply"."forms" ADD CONSTRAINT "forms_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "firstreply"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "firstreply"."leads" ADD CONSTRAINT "leads_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "firstreply"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "firstreply"."leads" ADD CONSTRAINT "leads_form_id_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "firstreply"."forms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "firstreply"."meetings" ADD CONSTRAINT "meetings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "firstreply"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "firstreply"."meetings" ADD CONSTRAINT "meetings_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "firstreply"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "firstreply"."memberships" ADD CONSTRAINT "memberships_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "firstreply"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "firstreply"."memberships" ADD CONSTRAINT "memberships_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "firstreply"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "firstreply"."messages" ADD CONSTRAINT "messages_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "firstreply"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "firstreply"."messages" ADD CONSTRAINT "messages_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "firstreply"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "firstreply"."messages" ADD CONSTRAINT "messages_reviewed_by_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "firstreply"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "firstreply"."outbox" ADD CONSTRAINT "outbox_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "firstreply"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "firstreply"."outbox" ADD CONSTRAINT "outbox_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "firstreply"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "firstreply"."outbox" ADD CONSTRAINT "outbox_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "firstreply"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "firstreply"."session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "firstreply"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "firstreply"."slot_offers" ADD CONSTRAINT "slot_offers_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "firstreply"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "firstreply"."slot_offers" ADD CONSTRAINT "slot_offers_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "firstreply"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "firstreply"."webhook_tokens" ADD CONSTRAINT "webhook_tokens_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "firstreply"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_id_idx" ON "firstreply"."account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "agent_events_org_created_idx" ON "firstreply"."agent_events" USING btree ("org_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "agent_events_entity_idx" ON "firstreply"."agent_events" USING btree ("entity_type","entity_id","created_at" DESC NULLS LAST) WHERE "firstreply"."agent_events"."entity_id" is not null;--> statement-breakpoint
CREATE INDEX "availability_rules_org_idx" ON "firstreply"."availability_rules" USING btree ("org_id","weekday");--> statement-breakpoint
CREATE UNIQUE INDEX "blackouts_org_date_key" ON "firstreply"."blackouts" USING btree ("org_id","date");--> statement-breakpoint
CREATE INDEX "forms_org_idx" ON "firstreply"."forms" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "leads_org_status_created_idx" ON "firstreply"."leads" USING btree ("org_id","status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "leads_org_created_idx" ON "firstreply"."leads" USING btree ("org_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "leads_org_email_created_idx" ON "firstreply"."leads" USING btree ("org_id","email","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "meetings_org_starts_idx" ON "firstreply"."meetings" USING btree ("org_id","starts_at");--> statement-breakpoint
CREATE INDEX "meetings_lead_idx" ON "firstreply"."meetings" USING btree ("lead_id");--> statement-breakpoint
CREATE UNIQUE INDEX "meetings_org_starts_booked_key" ON "firstreply"."meetings" USING btree ("org_id","starts_at") WHERE "firstreply"."meetings"."status" = 'booked';--> statement-breakpoint
CREATE INDEX "memberships_user_id_idx" ON "firstreply"."memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "messages_org_status_idx" ON "firstreply"."messages" USING btree ("org_id","status","created_at");--> statement-breakpoint
CREATE INDEX "messages_lead_created_idx" ON "firstreply"."messages" USING btree ("lead_id","created_at");--> statement-breakpoint
CREATE INDEX "outbox_org_created_idx" ON "firstreply"."outbox" USING btree ("org_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "firstreply"."session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "slot_offers_message_idx" ON "firstreply"."slot_offers" USING btree ("message_id","starts_at");--> statement-breakpoint
CREATE INDEX "slot_offers_org_idx" ON "firstreply"."slot_offers" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "firstreply"."verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "webhook_tokens_org_idx" ON "firstreply"."webhook_tokens" USING btree ("org_id");