import "server-only";
import { and, count, desc, eq, gte, inArray, isNull, type SQL } from "drizzle-orm";
import { getDb } from "../client";
import { forms, leads } from "../schema";
import type { Lead, LeadEnrichment, LeadFit, LeadSource, LeadStatus } from "../types";
import { clampLimit, NotFoundError } from "./shared";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Spec 3.1: a second message from the same email within 30 days joins the existing lead. */
export const DEDUPE_WINDOW_DAYS = 30;

/** Trimmed, lower-cased email: the stored and compared form. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Lower-case domain part of an email, or null. */
export function emailDomain(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at < 1 || at === email.length - 1) return null;
  return email.slice(at + 1).trim().toLowerCase() || null;
}

export type CreateLeadInput = {
  source: LeadSource;
  sourceLabel?: string | null;
  formId?: string | null;
  name?: string | null;
  email: string;
  company?: string | null;
  /** Defaults to the email's domain. */
  domain?: string | null;
  message?: string;
  custom?: Record<string, unknown>;
  leadTimezone?: string | null;
  /** e.g. "spam" when the honeypot was filled. Defaults to "new". */
  status?: LeadStatus;
  /** Backdating for demo data and tests. */
  createdAt?: Date;
};

export async function create(orgId: string, input: CreateLeadInput): Promise<Lead> {
  const email = normalizeEmail(input.email);
  if (!email.includes("@")) throw new Error("A lead needs a valid email address.");
  const db = await getDb();
  if (input.formId) {
    const [form] = await db
      .select({ id: forms.id })
      .from(forms)
      .where(and(eq(forms.id, input.formId), eq(forms.orgId, orgId)))
      .limit(1);
    if (!form) throw new NotFoundError("Form");
  }
  const [row] = await db
    .insert(leads)
    .values({
      orgId,
      source: input.source,
      sourceLabel: input.sourceLabel ?? null,
      formId: input.formId ?? null,
      name: input.name?.trim() || null,
      email,
      company: input.company?.trim() || null,
      domain: input.domain?.trim().toLowerCase() || emailDomain(email),
      message: input.message ?? "",
      custom: input.custom ?? {},
      leadTimezone: input.leadTimezone ?? null,
      status: input.status ?? "new",
      ...(input.createdAt ? { createdAt: input.createdAt, updatedAt: input.createdAt } : {}),
    })
    .returning();
  return row;
}

export async function getById(orgId: string, leadId: string): Promise<Lead | null> {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(leads)
    .where(and(eq(leads.id, leadId), eq(leads.orgId, orgId)))
    .limit(1);
  return row ?? null;
}

export type ListLeadsOptions = {
  status?: LeadStatus | readonly LeadStatus[];
  limit?: number;
  offset?: number;
};

/** Newest first, optionally filtered by one or more statuses. */
export async function listForOrg(orgId: string, options: ListLeadsOptions = {}): Promise<Lead[]> {
  const where: SQL[] = [eq(leads.orgId, orgId)];
  if (typeof options.status === "string") where.push(eq(leads.status, options.status));
  else if (options.status) {
    if (options.status.length === 0) return [];
    where.push(inArray(leads.status, [...options.status]));
  }
  const db = await getDb();
  return db
    .select()
    .from(leads)
    .where(and(...where))
    .orderBy(desc(leads.createdAt), desc(leads.id))
    .limit(clampLimit(options.limit, 100, 500))
    .offset(Math.max(0, Math.floor(options.offset ?? 0)));
}

/**
 * Dedupe lookup: the most recent lead from this email (case-insensitive)
 * created within the last `days` days, or null.
 */
export async function findRecentByEmail(
  orgId: string,
  email: string,
  days: number = DEDUPE_WINDOW_DAYS,
  now: Date = new Date(),
): Promise<Lead | null> {
  const since = new Date(now.getTime() - days * DAY_MS);
  const db = await getDb();
  const [row] = await db
    .select()
    .from(leads)
    .where(and(eq(leads.orgId, orgId), eq(leads.email, normalizeEmail(email)), gte(leads.createdAt, since)))
    .orderBy(desc(leads.createdAt))
    .limit(1);
  return row ?? null;
}

export async function updateStatus(orgId: string, leadId: string, status: LeadStatus): Promise<Lead | null> {
  const db = await getDb();
  const [row] = await db
    .update(leads)
    .set({ status })
    .where(and(eq(leads.id, leadId), eq(leads.orgId, orgId)))
    .returning();
  return row ?? null;
}

export type LeadScore = {
  /** 0..100 (clamped and rounded). */
  score: number;
  fit: LeadFit;
  reasons: string[];
};

export async function updateScore(orgId: string, leadId: string, result: LeadScore): Promise<Lead | null> {
  const score = Math.min(100, Math.max(0, Math.round(result.score)));
  const db = await getDb();
  const [row] = await db
    .update(leads)
    .set({ score, fit: result.fit, scoreReasons: result.reasons })
    .where(and(eq(leads.id, leadId), eq(leads.orgId, orgId)))
    .returning();
  return row ?? null;
}

/** Stores the research result; also fills `company` / `domain` when given. */
export async function updateEnrichment(
  orgId: string,
  leadId: string,
  enrichment: LeadEnrichment,
  extra: { company?: string | null; domain?: string | null } = {},
): Promise<Lead | null> {
  const values: Partial<typeof leads.$inferInsert> = { enrichment };
  if (extra.company !== undefined) values.company = extra.company?.trim() || null;
  if (extra.domain !== undefined) values.domain = extra.domain?.trim().toLowerCase() || null;
  const db = await getDb();
  const [row] = await db
    .update(leads)
    .set(values)
    .where(and(eq(leads.id, leadId), eq(leads.orgId, orgId)))
    .returning();
  return row ?? null;
}

/** Records the first outbound reply time once; later calls are no-ops. True when it was set now. */
export async function setFirstReplyAt(orgId: string, leadId: string, at: Date = new Date()): Promise<boolean> {
  const db = await getDb();
  const rows = await db
    .update(leads)
    .set({ firstReplyAt: at })
    .where(and(eq(leads.id, leadId), eq(leads.orgId, orgId), isNull(leads.firstReplyAt)))
    .returning({ id: leads.id });
  return rows.length > 0;
}

/** Leads created at or after `since` (Free plan: 25 per month). */
export async function countCreatedSince(orgId: string, since: Date): Promise<number> {
  const db = await getDb();
  const [row] = await db
    .select({ n: count() })
    .from(leads)
    .where(and(eq(leads.orgId, orgId), gte(leads.createdAt, since)));
  return row?.n ?? 0;
}
