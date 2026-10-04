import "server-only";
import { classifyReply, type ClassifyInput, type ClassifyResult } from "@/lib/ai/prompts/classify";
import { draftDecline, draftReply, type DeclineInput, type DraftResult, type ReplyInput } from "@/lib/ai/prompts/reply";
import { scoreLead, type ScoreInput, type ScoreResult } from "@/lib/ai/prompts/score";
import {
  simulateLeadReply,
  type SimulateInput,
  type SimulateResult,
} from "@/lib/ai/prompts/simulate-lead-reply";
import { fallbackClassify, fallbackDecline, fallbackReply, fallbackScore, fallbackSimulate } from "./fallbacks";
import { errorText, type ServiceDeps } from "./shared";

/**
 * Every model call goes through here: the injected dependency (tests) or the
 * real prompt, and the deterministic fallback when the call throws. The
 * caller logs `fallbackReason` so the audit trail shows why a template was
 * used.
 */

export type ModelOutcome<T> = { result: T; fallbackReason: string | null };

async function run<I, T>(
  real: (input: I) => Promise<T>,
  injected: ((input: I) => Promise<T>) | undefined,
  fallback: (input: I) => T,
  input: I,
  label: string,
): Promise<ModelOutcome<T>> {
  try {
    return { result: await (injected ?? real)(input), fallbackReason: null };
  } catch (error) {
    const reason = errorText(error);
    if (!(error instanceof Error && error.name === "AiUnavailableError")) {
      console.warn(`[ai] ${label} failed, using the fallback:`, reason);
    }
    return { result: fallback(input), fallbackReason: reason };
  }
}

export function runScore(input: ScoreInput, deps?: ServiceDeps): Promise<ModelOutcome<ScoreResult>> {
  return run(scoreLead, deps?.scoreLead, fallbackScore, input, "lead_scorer");
}

export function runReply(input: ReplyInput, deps?: ServiceDeps): Promise<ModelOutcome<DraftResult>> {
  return run(draftReply, deps?.draftReply, fallbackReply, input, "reply_writer");
}

export function runDecline(input: DeclineInput, deps?: ServiceDeps): Promise<ModelOutcome<DraftResult>> {
  return run(draftDecline, deps?.draftDecline, fallbackDecline, input, "decline_writer");
}

export function runClassify(input: ClassifyInput, deps?: ServiceDeps): Promise<ModelOutcome<ClassifyResult>> {
  return run(classifyReply, deps?.classifyReply, fallbackClassify, input, "reply_classifier");
}

export function runSimulate(input: SimulateInput, deps?: ServiceDeps): Promise<ModelOutcome<SimulateResult>> {
  return run(simulateLeadReply, deps?.simulateLeadReply, fallbackSimulate, input, "lead_reply_simulator");
}
