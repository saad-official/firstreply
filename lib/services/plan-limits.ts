import type { Organization, Plan } from "@/lib/db/types";

/**
 * Plan limits (spec 2). Free: 25 leads a calendar month (UTC), one hosted
 * form and one active webhook token, manual approval of every reply. Pro
 * ($39/month): unlimited leads, forms and tokens, and auto-reply for
 * high-score leads (autonomy "auto_high_score").
 *
 * Synthetic demo leads (source "demo") never count towards the monthly limit.
 *
 * Pure module (no database, no server-only) so client components can import
 * the constants and `isPlanLimitError` for upgrade prompts.
 */

export type PlanLimits = {
  /** null = unlimited. */
  leadsPerMonth: number | null;
  /** Active hosted forms; null = unlimited. */
  forms: number | null;
  /** Active (not revoked) webhook tokens; null = unlimited. */
  webhookTokens: number | null;
  /** Auto-send replies to high-score leads. */
  autonomy: boolean;
};

export const PLAN_LIMITS: Readonly<Record<Plan, PlanLimits>> = {
  free: { leadsPerMonth: 25, forms: 1, webhookTokens: 1, autonomy: false },
  pro: { leadsPerMonth: null, forms: null, webhookTokens: null, autonomy: true },
};

export const FREE_LEADS_PER_MONTH = 25;
export const PRO_PRICE_USD = 39;

export function limitsFor(plan: Plan): PlanLimits {
  return PLAN_LIMITS[plan];
}

export type PlanLimitCode = "leads_per_month" | "forms" | "webhook_tokens" | "autonomy";

/**
 * Thrown when an action exceeds the organization's plan. API routes map it to
 * HTTP 402; screens show `message` with an upgrade link to /billing.
 */
export class PlanLimitError extends Error {
  readonly code: PlanLimitCode;
  /** The limit that was hit (null for Pro-only features). */
  readonly limit: number | null;
  /** Current usage, when it applies. */
  readonly used: number | null;
  readonly upgradeUrl = "/billing";

  constructor(code: PlanLimitCode, message: string, details: { limit?: number | null; used?: number | null } = {}) {
    super(message);
    this.name = "PlanLimitError";
    this.code = code;
    this.limit = details.limit ?? null;
    this.used = details.used ?? null;
  }
}

export function isPlanLimitError(error: unknown): error is PlanLimitError {
  return error instanceof PlanLimitError || (error instanceof Error && error.name === "PlanLimitError");
}

/** First instant of the UTC calendar month containing `now`. */
export function monthStartUtc(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** First instant of the next UTC calendar month. */
export function nextMonthStartUtc(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

/** Throws PlanLimitError when the org has used its monthly lead allowance. */
export function assertLeadAllowance(org: Pick<Organization, "plan">, usedThisMonth: number): void {
  const limit = limitsFor(org.plan).leadsPerMonth;
  if (limit === null || usedThisMonth < limit) return;
  throw new PlanLimitError(
    "leads_per_month",
    `This workspace has received its ${limit} leads for this month on the Free plan. Upgrade to Pro for unlimited leads.`,
    { limit, used: usedThisMonth },
  );
}

/** Throws PlanLimitError unless the org may turn on auto-reply. */
export function assertAutonomyAllowed(org: Pick<Organization, "plan">): void {
  if (limitsFor(org.plan).autonomy) return;
  throw new PlanLimitError("autonomy", "Auto-reply for high-fit leads is a Pro feature. Upgrade to Pro to turn it on.");
}

/** Throws PlanLimitError when one more active form / webhook token would exceed the plan. */
export function assertCapacity(
  org: Pick<Organization, "plan">,
  what: "forms" | "webhook_tokens",
  activeCount: number,
): void {
  const limit = what === "forms" ? limitsFor(org.plan).forms : limitsFor(org.plan).webhookTokens;
  if (limit === null || activeCount < limit) return;
  const noun = what === "forms" ? "hosted form" : "webhook token";
  throw new PlanLimitError(
    what,
    `The Free plan includes ${limit} active ${noun}. Deactivate the existing one or upgrade to Pro for more.`,
    { limit, used: activeCount },
  );
}
