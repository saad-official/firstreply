import "server-only";
import * as agentEventsRepo from "@/lib/db/repositories/agentEvents";
import * as leadsRepo from "@/lib/db/repositories/leads";
import * as meetingsRepo from "@/lib/db/repositories/meetings";
import * as messagesRepo from "@/lib/db/repositories/messages";
import * as metricsRepo from "@/lib/db/repositories/metrics";
import type { AgentEvent, LeadStatus, Meeting, Organization } from "@/lib/db/types";
import { limitsFor, monthStartUtc } from "./plan-limits";

/**
 * Dashboard numbers (spec 3.6). Response time is measured over the last 30
 * days (a week is too few leads for a stable median); pipeline counts cover
 * the last 7 days.
 */

const DAY_MS = 86_400_000;
export const RESPONSE_WINDOW_DAYS = 30;
export const PIPELINE_WINDOW_DAYS = 7;
/** Spec 1: small businesses average about 47 hours to answer a lead. */
export const BENCHMARK_SECONDS = 47 * 3600;

export type ActivityItem = {
  id: string;
  at: Date;
  text: string;
  actor: AgentEvent["actor"];
  href: string | null;
};

export type Dashboard = {
  medianFirstResponseSeconds: number | null;
  repliedCount: number;
  repliedUnder60s: number;
  /** 0..1, null when nothing was replied to. */
  under60Rate: number | null;
  leadsThisWeek: number;
  byStatus: Record<LeadStatus, number>;
  meetingsBookedThisWeek: number;
  awaitingApproval: number;
  upcomingMeetings: Meeting[];
  nextUp: Awaited<ReturnType<typeof messagesRepo.listQueue>>;
  activity: ActivityItem[];
  hasLeads: boolean;
  usage: { leadsThisMonth: number; limit: number | null };
};

const EVENT_TEXT: Record<string, string> = {
  "lead.received": "New lead received",
  "lead.merged": "Follow-up message joined an existing lead",
  "lead.spam_honeypot": "Bot submission caught by the honeypot",
  "lead.enriched": "Company website researched",
  "lead.scored": "Lead scored against your rubric",
  "lead.archived_spam": "Lead archived as spam",
  "lead.archived": "Lead archived",
  "lead.process_failed": "Processing failed; it will be retried",
  "lead.rejected_plan_limit": "Lead refused: monthly plan limit reached",
  "message.drafted": "Reply drafted",
  "message.needs_human": "A reply needs your answer",
  "message.auto_approved": "High-fit reply auto-approved",
  "message.approved": "You approved a reply",
  "message.rejected": "You rejected a draft",
  "message.sent": "Email sent",
  "message.resent": "Failed email re-sent",
  "message.send_failed": "Email delivery failed",
  "reply.classified": "Lead reply read and classified",
  "reply.simulated": "Simulated a lead reply (demo)",
  "negotiation.countered": "Counter-offer drafted",
  "negotiation.closed": "Lead closed: not interested",
  "negotiation.follow_up_scheduled": "Follow-up scheduled after out-of-office",
  "meeting.booked": "Meeting booked",
  "meeting.booked_manually": "Meeting booked by hand",
  "meeting.held": "Meeting marked held",
  "meeting.no_show": "Meeting marked no-show",
  "meeting.cancelled": "Meeting cancelled",
  "settings.updated": "Settings updated",
  "availability.replaced": "Availability updated",
  "form.created": "Hosted form created",
  "webhook_token.created": "Webhook token created",
  "webhook_token.revoked": "Webhook token revoked",
  "billing.plan_synced": "Plan changed",
  "demo.seeded": "Demo workspace loaded",
  "followup.drafted": "Follow-up drafted",
  "draft.slots_refreshed": "Stale times in a draft refreshed",
};

function describe(event: AgentEvent): ActivityItem {
  const out = (event.output ?? {}) as Record<string, unknown>;
  let text = EVENT_TEXT[event.type] ?? event.type.replace(/[._]/g, " ");
  if (event.type === "lead.scored" && typeof out.score === "number") text = `Lead scored ${out.score} (${String(out.fit)} fit)`;
  if (event.type === "reply.classified" && typeof out.intent === "string") {
    text = `Lead reply classified: ${out.intent.replace(/_/g, " ")}`;
  }
  const leadId =
    event.entityType === "lead"
      ? event.entityId
      : ((event.input as Record<string, unknown> | null)?.leadId as string | undefined) ?? null;
  return { id: event.id, at: event.createdAt, text, actor: event.actor, href: leadId ? `/leads/${leadId}` : null };
}

export async function getDashboard(org: Pick<Organization, "id" | "plan">, now: Date = new Date()): Promise<Dashboard> {
  const responseSince = new Date(now.getTime() - RESPONSE_WINDOW_DAYS * DAY_MS);
  const weekSince = new Date(now.getTime() - PIPELINE_WINDOW_DAYS * DAY_MS);
  const [median, stats, byStatus, allTime, booked, awaiting, upcoming, nextUp, events, usage] = await Promise.all([
    metricsRepo.medianFirstResponseSeconds(org.id, responseSince),
    metricsRepo.firstResponseStats(org.id, responseSince, 60),
    metricsRepo.countsByStatus(org.id, { since: weekSince }),
    leadsRepo.listForOrg(org.id, { limit: 1 }),
    metricsRepo.meetingsBookedSince(org.id, weekSince),
    messagesRepo.countAwaitingApproval(org.id),
    meetingsRepo.listForOrg(org.id, { from: now, status: "booked", limit: 3 }),
    messagesRepo.listQueue(org.id, { limit: 4 }),
    agentEventsRepo.listForOrg(org.id, { limit: 12 }),
    leadsRepo.countBillableCreatedSince(org.id, monthStartUtc(now)),
  ]);
  const leadsThisWeek = Object.values(byStatus).reduce((a, b) => a + b, 0);
  return {
    medianFirstResponseSeconds: median,
    repliedCount: stats.replied,
    repliedUnder60s: stats.withinTarget,
    under60Rate: stats.replied > 0 ? stats.withinTarget / stats.replied : null,
    leadsThisWeek,
    byStatus,
    meetingsBookedThisWeek: booked,
    awaitingApproval: awaiting,
    upcomingMeetings: upcoming,
    nextUp,
    activity: events.map(describe),
    hasLeads: allTime.length > 0,
    usage: { leadsThisMonth: usage, limit: limitsFor(org.plan).leadsPerMonth },
  };
}
