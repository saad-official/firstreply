/**
 * Deterministic adjustments on top of the model's ICP score, and the action
 * decision that follows (spec 3.2 steps 3-4). The model judges fit against
 * the owner's rubric; these rules apply the signals the model should not be
 * trusted to weigh consistently.
 */
import { FITS, type Autonomy, type Fit, type LeadInput, type Plan, type ScoreOutput } from "./types";

export const FREE_MAIL_PENALTY = 10;
export const SHORT_MESSAGE_PENALTY = 10;
export const SHORT_MESSAGE_WORDS = 10;
export const AUTO_REPLY_MIN_SCORE = 70;
export const AUTO_REPLY_MIN_CONFIDENCE = 0.8;

/** Exact free-mail domains (lower-case). */
const FREE_MAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "ymail.com",
  "rocketmail.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "protonmail.ch",
  "pm.me",
  "mail.com",
  "zoho.com",
  "zohomail.com",
  "fastmail.com",
  "tutanota.com",
  "tuta.io",
  "hey.com",
  "qq.com",
  "163.com",
  "126.com",
  "web.de",
  "mail.ru",
  "inbox.com",
  "orange.fr",
  "wanadoo.fr",
  "libero.it",
  "btinternet.com",
]);

/** Brands that run free mail under many country TLDs, e.g. yahoo.co.uk, hotmail.fr, gmx.de. */
const FREE_MAIL_BRAND = /^(?:yahoo|hotmail|outlook|live|gmx|yandex|aol)\.(?:[a-z]{2,3})(?:\.[a-z]{2})?$/;

export function isFreeMailDomain(domain: string): boolean {
  const d = domain.trim().toLowerCase().replace(/^@/, "");
  if (d.length === 0) return false;
  return FREE_MAIL_DOMAINS.has(d) || FREE_MAIL_BRAND.test(d);
}

export function emailDomain(email: string): string {
  const at = email.lastIndexOf("@");
  return at === -1 ? "" : email.slice(at + 1).trim().toLowerCase();
}

/** Words containing at least one letter or digit. */
export function wordCount(text: string): number {
  return text.split(/\s+/).filter((token) => /[\p{L}\p{N}]/u.test(token)).length;
}

/** Spec bands: >= 70 high, 40-69 medium, 15-39 low, < 15 spam. */
export function fitFromScore(score: number): Fit {
  if (score >= 70) return "high";
  if (score >= 40) return "medium";
  if (score >= 15) return "low";
  return "spam";
}

const band = (fit: Fit) => FITS.indexOf(fit);

export type ScoreAdjustmentCode = "honeypot" | "free_mail" | "short_message" | "clamped" | "fit_rederived";

export interface ScoreAdjustment {
  code: ScoreAdjustmentCode;
  /** Change applied to the score (0 for fit-only changes). */
  delta: number;
  note: string;
}

export interface AdjustedScore extends ScoreOutput {
  modelScore: number;
  modelFit: Fit;
  /** In the order applied; empty when the model output stands. */
  adjustments: ScoreAdjustment[];
}

export type ScoringLead = Pick<LeadInput, "email" | "message" | "honeypotFilled">;

export function adjustScore(modelOutput: ScoreOutput, lead: ScoringLead): AdjustedScore {
  const base = {
    ...modelOutput,
    reasons: [...modelOutput.reasons],
    modelScore: modelOutput.score,
    modelFit: modelOutput.fit,
  };

  if (lead.honeypotFilled) {
    return {
      ...base,
      score: 0,
      fit: "spam",
      adjustments: [
        { code: "honeypot", delta: -modelOutput.score, note: "Form honeypot field was filled: treated as spam" },
      ],
    };
  }

  const adjustments: ScoreAdjustment[] = [];
  let score = Number.isFinite(modelOutput.score) ? Math.round(modelOutput.score) : 0;

  const domain = emailDomain(lead.email);
  if (isFreeMailDomain(domain)) {
    score -= FREE_MAIL_PENALTY;
    adjustments.push({ code: "free_mail", delta: -FREE_MAIL_PENALTY, note: `Free-mail address (${domain}): -${FREE_MAIL_PENALTY}` });
  }
  if (wordCount(lead.message) < SHORT_MESSAGE_WORDS) {
    score -= SHORT_MESSAGE_PENALTY;
    adjustments.push({
      code: "short_message",
      delta: -SHORT_MESSAGE_PENALTY,
      note: `Message under ${SHORT_MESSAGE_WORDS} words: -${SHORT_MESSAGE_PENALTY}`,
    });
  }

  const clamped = Math.min(100, Math.max(0, score));
  if (clamped !== score) {
    adjustments.push({ code: "clamped", delta: clamped - score, note: "Score clamped to 0..100" });
  }

  const derived = fitFromScore(clamped);
  let fit = modelOutput.fit;
  if (Math.abs(band(fit) - band(derived)) > 1) {
    adjustments.push({
      code: "fit_rederived",
      delta: 0,
      note: `Model fit "${fit}" disagreed with score ${clamped}; fit set to "${derived}"`,
    });
    fit = derived;
  }

  return { ...base, score: clamped, fit, adjustments };
}

export type LeadAction = "archive_spam" | "draft_decline" | "draft_reply" | "auto_reply";

/**
 * spam -> archive; low -> decline draft; medium/high -> reply draft.
 * Auto-reply needs Pro, autonomy `auto_high_score`, score >= 70, confidence
 * >= 0.8 and a high fit (a medium fit kept by the one-band rule never auto-sends).
 */
export function decideAction(
  org: { plan: Plan; autonomy: Autonomy },
  adjusted: Pick<AdjustedScore, "score" | "fit" | "confidence">,
): LeadAction {
  if (adjusted.fit === "spam") return "archive_spam";
  if (adjusted.fit === "low") return "draft_decline";
  const autoEligible =
    org.plan === "pro" &&
    org.autonomy === "auto_high_score" &&
    adjusted.fit === "high" &&
    adjusted.score >= AUTO_REPLY_MIN_SCORE &&
    Number.isFinite(adjusted.confidence) &&
    adjusted.confidence >= AUTO_REPLY_MIN_CONFIDENCE;
  return autoEligible ? "auto_reply" : "draft_reply";
}
