import { z } from "zod";

/**
 * Calendar date with no time or zone, "YYYY-MM-DD" (Postgres `date`).
 * Instants (`timestamptz`) are modelled as `Date`.
 *
 * Model-output schemas (score, reply draft, classification) never use
 * `.optional()`: Groq structured outputs run in strict JSON-schema mode, which
 * requires every property to be present. Absent values are `null` instead.
 */
export type IsoDate = string;

const IsoDateString = z.iso.date({ error: "date must be YYYY-MM-DD" });
const Confidence = z
  .number()
  .min(0, { error: "confidence must be >= 0" })
  .max(1, { error: "confidence must be <= 1" });

export function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const TimeZone = z.string().refine(isValidTimeZone, { error: "must be an IANA time zone, e.g. Europe/London" });

/* ------------------------------------------------------------------ */
/* Capture (spec 3.1)                                                  */
/* ------------------------------------------------------------------ */

export const LEAD_SOURCES = ["form", "webhook", "typeform", "tally", "webflow", "framer", "email", "demo"] as const;
export const LeadSourceSchema = z.enum(LEAD_SOURCES);
export type LeadSource = z.infer<typeof LeadSourceSchema>;

export const LeadInputSchema = z.object({
  name: z.string().trim().min(1).optional(),
  email: z.string().trim().toLowerCase().pipe(z.email({ error: "email must be an email address" })),
  company: z.string().trim().min(1).optional(),
  /** May be empty: a lead with only an email is still a lead. */
  message: z.string(),
  source: LeadSourceSchema,
  customFields: z.record(z.string(), z.string()).optional(),
  /** IANA zone from the form or email headers; slots are rendered in it. */
  leadTimezone: TimeZone.optional(),
  /** Extension beyond spec 3.1: the hosted form's honeypot field was filled (bot). */
  honeypotFilled: z.boolean().optional(),
});
export type LeadInput = z.infer<typeof LeadInputSchema>;

export const LEAD_STATUSES = ["new", "replied", "negotiating", "booked", "declined", "spam"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

/* ------------------------------------------------------------------ */
/* Scoring (spec 3.2)                                                  */
/* ------------------------------------------------------------------ */

/** Ordered worst to best; the index is the "band" used by adjustScore. */
export const FITS = ["spam", "low", "medium", "high"] as const;
export const FitSchema = z.enum(FITS);
export type Fit = z.infer<typeof FitSchema>;

export const ScoreOutputSchema = z.object({
  score: z.int({ error: "score must be a whole number" }).min(0).max(100),
  fit: FitSchema,
  reasons: z.array(z.string()),
  summary: z.string(),
  confidence: Confidence,
});
export type ScoreOutput = z.infer<typeof ScoreOutputSchema>;

export type Plan = "free" | "pro";
export type Autonomy = "manual" | "auto_high_score";

/* ------------------------------------------------------------------ */
/* Reply drafting (spec 3.4)                                           */
/* ------------------------------------------------------------------ */

export const ReplyDraftSchema = z.object({
  subject: z.string().min(1, { error: "subject is required" }),
  body: z.string().min(1, { error: "body is required" }),
  confidence: Confidence,
  rationale: z.string(),
});
export type ReplyDraft = z.infer<typeof ReplyDraftSchema>;

/* ------------------------------------------------------------------ */
/* Negotiation (spec 3.5)                                              */
/* ------------------------------------------------------------------ */

export const REPLY_INTENTS = [
  "accepts_slot",
  "proposes_time",
  "asks_question",
  "not_interested",
  "out_of_office",
  "other",
] as const;
export const ReplyIntentSchema = z.enum(REPLY_INTENTS);
export type ReplyIntent = z.infer<typeof ReplyIntentSchema>;

/** "YYYY-MM-DDTHH:mm[:ss[.sss]]" with an optional "Z" or "+hh:mm" offset. */
export const PROPOSED_START_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?$/;

function isValidProposedStart(value: string): boolean {
  const m = PROPOSED_START_PATTERN.exec(value);
  if (!m) return false;
  const [y, mo, d, h, mi] = [1, 2, 3, 4, 5].map((i) => Number(m[i]));
  const date = new Date(Date.UTC(y, mo - 1, d));
  return (
    date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d && h < 24 && mi < 60
  );
}

export const ReplyClassificationSchema = z.object({
  intent: ReplyIntentSchema,
  /** 0-based index into the slots we offered (the prompt labels them [0], [1], [2]). */
  acceptedSlotIndex: z.int().nonnegative().nullable(),
  /** Wall-clock start in `proposedTimezone` (no offset), or an absolute instant with an offset. */
  proposedStart: z
    .string()
    .refine(isValidProposedStart, { error: "proposedStart must be YYYY-MM-DDTHH:mm" })
    .nullable(),
  proposedTimezone: z.string().nullable(),
  /** Out-of-office return date, YYYY-MM-DD. */
  returnDate: IsoDateString.nullable(),
  summary: z.string(),
  suggestedAction: z.string(),
  confidence: Confidence,
});
export type ReplyClassification = z.infer<typeof ReplyClassificationSchema>;

/* ------------------------------------------------------------------ */
/* Availability and slots (spec 3.3)                                   */
/* ------------------------------------------------------------------ */

export const MINUTES_PER_DAY = 1440;

export const AvailabilityRuleSchema = z
  .object({
    /** ISO weekday: 1 = Monday ... 7 = Sunday, in the org's time zone. */
    weekday: z.int().min(1).max(7),
    /** Minutes after local midnight, inclusive. */
    startMinute: z.int().min(0).max(MINUTES_PER_DAY),
    /** Minutes after local midnight, exclusive; 1440 = end of day. */
    endMinute: z.int().min(0).max(MINUTES_PER_DAY),
  })
  .refine((r) => r.endMinute > r.startMinute, { error: "endMinute must be after startMinute" });
export type AvailabilityRule = z.infer<typeof AvailabilityRuleSchema>;

export const MEETING_LENGTHS = [15, 30, 45, 60] as const;

export const SlotPolicySchema = z.object({
  /** Org time zone; rules and blackouts are read in it. */
  timezone: TimeZone,
  meetingMinutes: z
    .int()
    .refine((m) => (MEETING_LENGTHS as readonly number[]).includes(m), {
      error: `meetingMinutes must be one of ${MEETING_LENGTHS.join(", ")}`,
    })
    .default(30),
  bufferMinutes: z.int().min(0).max(240).default(0),
  minNoticeHours: z.number().min(0).max(24 * 30).default(4),
  horizonBusinessDays: z.int().min(1).max(60).default(10),
  blackoutDates: z.array(IsoDateString).default([]),
});
export type SlotPolicy = z.infer<typeof SlotPolicySchema>;

export const DEFAULT_SLOT_POLICY: SlotPolicy = {
  timezone: "UTC",
  meetingMinutes: 30,
  bufferMinutes: 0,
  minNoticeHours: 4,
  horizonBusinessDays: 10,
  blackoutDates: [],
};

const TimeRange = z
  .object({ start: z.date(), end: z.date() })
  .refine((r) => r.end.getTime() > r.start.getTime(), { error: "end must be after start" });

export const SlotSchema = TimeRange;
export type Slot = z.infer<typeof SlotSchema>;

/** An existing booking or calendar busy block. */
export const BusySchema = TimeRange;
export type Busy = z.infer<typeof BusySchema>;
