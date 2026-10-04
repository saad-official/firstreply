/**
 * Stub dependencies for service tests: no network, no model. Each test file
 * calls `vi.mock("server-only")` itself, then `startTestDb()` (tests/db/helpers).
 */
import type { CallMeta } from "@/lib/ai/generate";
import type { ClassifyResult } from "@/lib/ai/prompts/classify";
import type { DeclineInput, DraftResult, ReplyInput } from "@/lib/ai/prompts/reply";
import type { ScoreInput, ScoreResult } from "@/lib/ai/prompts/score";
import * as availabilityRepo from "@/lib/db/repositories/availability";
import type { LeadEnrichment, OutboxAttachment } from "@/lib/db/types";
import { adjustScore } from "@/lib/domain/scoring";
import type { Fit, ReplyClassification } from "@/lib/domain/types";
import type { EmailProvider, OutgoingEmail, SendResult } from "@/lib/email/provider";
import { fallbackDecline, fallbackReply } from "@/lib/services/fallbacks";
import type { ServiceDeps } from "@/lib/services/shared";

export const STUB_META: CallMeta = {
  model: "stub",
  promptVersion: "stub/v1",
  tokensIn: 1,
  tokensOut: 1,
  latencyMs: 1,
  attempts: 1,
};

export function stubScore(score: number, fit: Fit, confidence = 0.9) {
  return async (input: ScoreInput): Promise<ScoreResult> => {
    const output = { score, fit, reasons: ["stub reason"], summary: "Stub summary.", confidence };
    return { output, adjusted: adjustScore(output, input.lead), meta: STUB_META };
  };
}

/** The template writer, labelled as a model call with high confidence (so auto-send rules can be exercised). */
export async function stubReply(input: ReplyInput): Promise<DraftResult> {
  const result = fallbackReply(input);
  const confidence = result.validation.ok ? 0.9 : 0;
  return { ...result, draft: { ...result.draft, confidence, rationale: "Stub draft." }, meta: STUB_META };
}

export async function stubDecline(input: DeclineInput): Promise<DraftResult> {
  const result = fallbackDecline(input);
  return { ...result, draft: { ...result.draft, rationale: "Stub decline." }, meta: STUB_META };
}

export function stubClassify(partial: Partial<ReplyClassification>) {
  return async (): Promise<ClassifyResult> => ({
    classification: {
      intent: "other",
      acceptedSlotIndex: null,
      proposedStart: null,
      proposedTimezone: null,
      returnDate: null,
      summary: "Stub classification.",
      suggestedAction: "Do the thing.",
      confidence: 0.9,
      ...partial,
    },
    meta: STUB_META,
  });
}

export async function stubEnrich(domain: string | null): Promise<LeadEnrichment> {
  return { domain, freeMail: false, title: "Acme Ltd", description: "Widgets for everyone.", summary: "Acme Ltd: Widgets for everyone.", fetchedAt: new Date().toISOString() };
}

export type SentMail = OutgoingEmail & { attachments?: OutboxAttachment[] };

export class RecordingProvider implements EmailProvider {
  readonly name = "outbox" as const;
  sent: SentMail[] = [];
  /** Number of upcoming sends that should throw. */
  failNext = 0;
  async send(email: OutgoingEmail): Promise<SendResult> {
    if (this.failNext > 0) {
      this.failNext -= 1;
      throw new Error("provider down");
    }
    this.sent.push(email);
    return { provider: "outbox", providerMessageId: `stub-${this.sent.length}`, deliveredTo: email.to, demo: true };
  }
}

export function makeDeps(overrides: Partial<ServiceDeps> = {}): ServiceDeps & { emailProvider: RecordingProvider } {
  return {
    scoreLead: stubScore(82, "high"),
    draftReply: stubReply,
    draftDecline: stubDecline,
    classifyReply: stubClassify({}),
    enrich: stubEnrich,
    emailProvider: new RecordingProvider(),
    ...overrides,
  } as ServiceDeps & { emailProvider: RecordingProvider };
}

/** Every day 08:00-18:00 so slot tests pass whatever weekday they run on. */
export async function openEveryDay(orgId: string): Promise<void> {
  await availabilityRepo.replaceRules(
    orgId,
    [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startMinute: 8 * 60, endMinute: 18 * 60 })),
  );
}
