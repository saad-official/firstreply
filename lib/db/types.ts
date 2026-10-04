/**
 * Row types inferred from lib/db/schema.ts. Type-only: safe to import from
 * client components (e.g. `Plan`, `LeadStatus` in the app shell and board).
 */
import type {
  agentEvents,
  availabilityRules,
  blackouts,
  forms,
  leads,
  meetings,
  memberships,
  messages,
  organizations,
  outbox,
  session,
  slotOffers,
  user,
  webhookTokens,
} from "./schema";

export type { Db, DbHandle, Schema } from "./client";
export type {
  FormField,
  FormFieldType,
  LeadEnrichment,
  LeadSource,
  MessageClassification,
  OrgVoice,
  OutboxAttachment,
} from "./schema";

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

export type User = typeof user.$inferSelect;
export type Session = typeof session.$inferSelect;

export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;
export type Plan = Organization["plan"];
export type Autonomy = Organization["autonomy"];

export type Membership = typeof memberships.$inferSelect;
export type MembershipRole = Membership["role"];

export type AvailabilityRule = typeof availabilityRules.$inferSelect;
/** A rule as the settings form and suggestSlots see it (no ids). */
export type AvailabilityRuleInput = Pick<AvailabilityRule, "weekday" | "startMinute" | "endMinute">;
export type Blackout = typeof blackouts.$inferSelect;

export type Form = typeof forms.$inferSelect;
export type NewForm = typeof forms.$inferInsert;

export type WebhookToken = typeof webhookTokens.$inferSelect;

export type Lead = typeof leads.$inferSelect;
export type NewLead = typeof leads.$inferInsert;
export type LeadStatus = Lead["status"];
export type LeadFit = NonNullable<Lead["fit"]>;

export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type MessageDirection = Message["direction"];
export type MessageKind = Message["kind"];
export type MessageStatus = Message["status"];

export type SlotOffer = typeof slotOffers.$inferSelect;

export type Meeting = typeof meetings.$inferSelect;
export type NewMeeting = typeof meetings.$inferInsert;
export type MeetingStatus = Meeting["status"];
/** A busy interval for slot suggestion. */
export type BusyInterval = { startsAt: Date; endsAt: Date };

export type OutboxMessage = typeof outbox.$inferSelect;
export type NewOutboxMessage = typeof outbox.$inferInsert;

export type AgentEvent = typeof agentEvents.$inferSelect;
export type NewAgentEvent = typeof agentEvents.$inferInsert;
export type Actor = AgentEvent["actor"];
