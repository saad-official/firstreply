import "server-only";
import { logAgentEvent, type AgentEventInput } from "@/lib/ai/log";
import type { ClassifyInput, ClassifyResult } from "@/lib/ai/prompts/classify";
import type { DeclineInput, DraftResult, ReplyInput } from "@/lib/ai/prompts/reply";
import type { ScoreInput, ScoreResult } from "@/lib/ai/prompts/score";
import type { SimulateInput, SimulateResult } from "@/lib/ai/prompts/simulate-lead-reply";
import { getDb } from "@/lib/db/client";
import type { Lead, LeadEnrichment, Organization } from "@/lib/db/types";
import type { EmailProvider } from "@/lib/email/provider";
import { publicEnv } from "@/lib/env";

/**
 * Injectable dependencies shared by the services. Production leaves them
 * unset (Groq/Gemini prompts, live homepage fetch, the configured email
 * provider, the wall clock); tests pass stubs so nothing touches the network.
 */
export type ServiceDeps = {
  scoreLead?: (input: ScoreInput) => Promise<ScoreResult>;
  draftReply?: (input: ReplyInput) => Promise<DraftResult>;
  draftDecline?: (input: DeclineInput) => Promise<DraftResult>;
  classifyReply?: (input: ClassifyInput) => Promise<ClassifyResult>;
  simulateLeadReply?: (input: SimulateInput) => Promise<SimulateResult>;
  /** Company research for a lead's email domain. */
  enrich?: (domain: string | null) => Promise<LeadEnrichment>;
  emailProvider?: EmailProvider;
  now?: () => Date;
};

export function nowFrom(deps?: ServiceDeps): Date {
  return deps?.now ? deps.now() : new Date();
}

/** Append-only audit log; never throws. */
export async function audit(event: AgentEventInput): Promise<void> {
  await logAgentEvent(await getDb(), event);
}

/** Absolute app origin without a trailing slash. */
export function appOrigin(): string {
  return publicEnv.appUrl.replace(/\/+$/, "");
}

/** Public booking page for the org. */
export function bookingUrlFor(org: Pick<Organization, "bookingSlug">): string {
  return `${appOrigin()}/b/${org.bookingSlug}`;
}

/** Signature block used in every outbound message (voice.signOff, else sender name + business name). */
export function signatureFor(org: Pick<Organization, "name" | "voice">): string {
  const signOff = org.voice?.signOff?.trim();
  if (signOff) return signOff;
  const sender = org.voice?.senderName?.trim();
  return sender ? `${sender}\n${org.name}` : org.name;
}

/** What the reply offers: the owner's offer text, else "a <n>-minute intro call". */
export function offerFor(org: Pick<Organization, "offer" | "meetingLengthMinutes">): string {
  return org.offer.trim() || `a ${org.meetingLengthMinutes}-minute intro call`;
}

/** Zone slots are shown to the lead in: their own when known, else the org's. */
export function leadZone(lead: Pick<Lead, "leadTimezone">, org: Pick<Organization, "timezone">): string {
  return lead.leadTimezone || org.timezone;
}

export const DEFAULT_RUBRIC =
  "Any genuine enquiry from a business or person asking about our services. Not a fit: sales pitches to us, SEO or link-building offers, job applications, and requests for free work.";

export function rubricFor(org: Pick<Organization, "rubric">): string {
  return org.rubric.trim() || DEFAULT_RUBRIC;
}

/** Plain text -> minimal HTML: every character escaped, paragraphs and line breaks kept. */
export function textToHtml(text: string): string {
  const escape = (value: string) =>
    value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  return text
    .trim()
    .split(/\r?\n\s*\r?\n/)
    .map((para) => `<p>${escape(para).replace(/\r?\n/g, "<br>")}</p>`)
    .join("\n");
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
