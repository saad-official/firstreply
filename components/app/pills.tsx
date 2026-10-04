import type { LeadFit, LeadStatus, MessageKind, MessageStatus } from "@/lib/db/types";
import { cn } from "@/lib/utils";

/**
 * Status vocabulary as pills (globals.css `pill`): coral = needs a reply,
 * lemon = waiting on you, sea = booked/good, night = done, quiet = closed.
 */

type Tone = "coral" | "lemon" | "sea" | "night" | "quiet" | "outline";

const TONE: Record<Tone, string> = {
  coral: "bg-coral-ink text-white",
  lemon: "bg-lemon text-lemon-foreground",
  sea: "bg-sea text-sea-foreground",
  night: "bg-foreground text-background",
  quiet: "bg-foreground/[0.07] text-foreground/80",
  outline: "border border-border bg-background text-foreground/80",
};

export function Pill({ tone, className, children }: { tone: Tone; className?: string; children: React.ReactNode }) {
  return <span className={cn("pill whitespace-nowrap", TONE[tone], className)}>{children}</span>;
}

export const STATUS_LABEL: Record<LeadStatus, string> = {
  new: "New",
  replied: "Replied",
  negotiating: "Negotiating",
  booked: "Booked",
  declined: "Declined",
  spam: "Spam",
  archived: "Archived",
};

const STATUS_TONE: Record<LeadStatus, Tone> = {
  new: "coral",
  replied: "outline",
  negotiating: "lemon",
  booked: "sea",
  declined: "quiet",
  spam: "quiet",
  archived: "quiet",
};

export function StatusPill({ status, className }: { status: LeadStatus; className?: string }) {
  return (
    <Pill tone={STATUS_TONE[status]} className={className}>
      {status === "new" ? <span aria-hidden className="size-1.5 rounded-full bg-white" /> : null}
      {STATUS_LABEL[status]}
    </Pill>
  );
}

const FIT_TONE: Record<LeadFit, Tone> = { high: "sea", medium: "outline", low: "quiet", spam: "quiet" };

export function FitPill({ fit, className }: { fit: LeadFit | null; className?: string }) {
  if (!fit) return <span className="text-xs text-muted-foreground">Not scored</span>;
  return (
    <Pill tone={FIT_TONE[fit]} className={className}>
      {fit === "spam" ? "Spam" : `${fit[0].toUpperCase()}${fit.slice(1)} fit`}
    </Pill>
  );
}

/** Score as a mono number with a thin meter (0..100). */
export function Score({ score, className }: { score: number | null; className?: string }) {
  if (score === null) return <span className="stopwatch text-sm text-muted-foreground">–</span>;
  const tone = score >= 70 ? "bg-sea" : score >= 40 ? "bg-lemon" : "bg-foreground/30";
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span className="stopwatch w-7 text-right text-sm">{score}</span>
      <span aria-hidden className="h-1.5 w-12 overflow-hidden rounded-full bg-foreground/10">
        <span className={cn("block h-full rounded-full", tone)} style={{ width: `${Math.max(4, score)}%` }} />
      </span>
    </span>
  );
}

export const KIND_LABEL: Record<MessageKind, string> = {
  reply: "First reply",
  decline: "Decline",
  counter: "Counter-offer",
  question_answer: "Answer",
  confirmation: "Confirmation",
  inbound: "From the lead",
};

const MESSAGE_STATUS_TONE: Record<MessageStatus, Tone> = {
  draft: "lemon",
  approved: "outline",
  sent: "sea",
  rejected: "quiet",
  received: "outline",
};

const MESSAGE_STATUS_LABEL: Record<MessageStatus, string> = {
  draft: "Awaiting approval",
  approved: "Approved, sending",
  sent: "Sent",
  rejected: "Rejected",
  received: "Received",
};

export function MessageStatusPill({ status }: { status: MessageStatus }) {
  return <Pill tone={MESSAGE_STATUS_TONE[status]}>{MESSAGE_STATUS_LABEL[status]}</Pill>;
}
