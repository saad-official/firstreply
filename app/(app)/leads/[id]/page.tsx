import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarCheck, Download, Globe, Sparkles } from "lucide-react";
import { DraftReview } from "@/components/app/draft-review";
import {
  ArchiveButton,
  BookManuallyDialog,
  ReprocessButton,
  SimulateReplyDialog,
} from "@/components/app/lead-actions";
import { FitPill, KIND_LABEL, MessageStatusPill, Pill, Score, StatusPill } from "@/components/app/pills";
import { WaitReasons } from "@/components/app/wait-reasons";
import { requireOrgContext } from "@/lib/auth/session";
import * as agentEventsRepo from "@/lib/db/repositories/agentEvents";
import * as leadsRepo from "@/lib/db/repositories/leads";
import * as meetingsRepo from "@/lib/db/repositories/meetings";
import * as messagesRepo from "@/lib/db/repositories/messages";
import { isUuid } from "@/lib/db/repositories/shared";
import * as slotOffersRepo from "@/lib/db/repositories/slotOffers";
import type { Message, SlotOffer } from "@/lib/db/types";
import { formatSlotFor } from "@/lib/domain/slots";
import { formatAgo, formatDateTime, formatDuration, secondsBetween } from "@/lib/format";
import { explainWait } from "@/lib/services/queue-reasons";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Lead" };
export const maxDuration = 60;

const INTENT_LABEL: Record<string, string> = {
  accepts_slot: "Accepted a time",
  proposes_time: "Proposed another time",
  asks_question: "Asked a question",
  not_interested: "Not interested",
  out_of_office: "Out of office",
  other: "Unclear",
};

const NEGATIVE = /^(?:no|not|missing|unclear|lacks?|without|vague|free-mail|message under|form honeypot)\b|-\d+\s*$/i;

function signOf(reason: string): "+" | "−" | "~" {
  if (/clamped|disagreed/i.test(reason)) return "~";
  return NEGATIVE.test(reason.trim()) ? "−" : "+";
}

export default async function LeadPage({ params }: PageProps<"/leads/[id]">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const { org } = await requireOrgContext();
  const lead = await leadsRepo.getById(org.id, id);
  if (!lead) notFound();

  const [thread, meetings, events] = await Promise.all([
    messagesRepo.listForLead(org.id, lead.id),
    meetingsRepo.listForLead(org.id, lead.id),
    agentEventsRepo.listForEntity(org.id, "lead", lead.id, { limit: 20 }),
  ]);
  const offers = await slotOffersRepo.listForMessages(
    org.id,
    thread.filter((m) => m.direction === "out").map((m) => m.id),
  );
  const now = new Date();
  const zone = lead.leadTimezone ?? org.timezone;
  const sentOffer = thread.some((m) => m.direction === "out" && m.status === "sent" && (offers.get(m.id)?.length ?? 0) > 0);
  const anySent = thread.some((m) => m.direction === "out" && m.status === "sent");
  const enrichment = lead.enrichment ?? {};
  const displayName = lead.name ?? lead.email;
  const custom = Object.entries(lead.custom ?? {});

  return (
    <>
      <Link
        href="/leads"
        className="mb-4 inline-flex items-center gap-1.5 rounded-sm text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <ArrowLeft className="size-4" aria-hidden />
        All leads
      </Link>

      <header className="flex flex-col gap-4 pb-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={lead.status} />
            <FitPill fit={lead.fit} />
            {lead.source === "demo" ? <Pill tone="quiet">Demo data</Pill> : null}
          </div>
          <h1 className="font-heading text-3xl leading-tight tracking-tight break-words">{displayName}</h1>
          <p className="text-sm break-words text-muted-foreground">
            {[lead.company, lead.email, lead.sourceLabel ?? lead.source].filter(Boolean).join(" · ")}
          </p>
          <p className="stopwatch text-xs text-muted-foreground">
            Received {formatDateTime(lead.createdAt, org.timezone)} ({formatAgo(lead.createdAt, now)})
            {lead.firstReplyAt
              ? ` · first reply in ${formatDuration(secondsBetween(lead.createdAt, lead.firstReplyAt))}`
              : lead.status === "new"
                ? ` · waiting ${formatDuration(secondsBetween(lead.createdAt, now))}`
                : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {sentOffer && !["booked", "declined", "spam", "archived"].includes(lead.status) ? (
            <SimulateReplyDialog leadId={lead.id} leadName={displayName} />
          ) : null}
          {lead.status !== "booked" ? (
            <BookManuallyDialog leadId={lead.id} timezone={org.timezone} minutes={org.meetingLengthMinutes} />
          ) : null}
          {!anySent ? <ReprocessButton leadId={lead.id} /> : null}
          {lead.status !== "archived" ? <ArchiveButton leadId={lead.id} /> : null}
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,4fr)]">
        <section aria-labelledby="thread-title" className="min-w-0">
          <h2 id="thread-title" className="font-heading text-xl">
            Conversation
          </h2>
          <ol className="mt-3 grid gap-3">
            <li className="rounded-2xl bg-card p-4 ring-1 ring-foreground/10">
              <p className="text-xs font-semibold text-foreground/70">
                Original enquiry <span className="stopwatch font-normal">· {formatDateTime(lead.createdAt, org.timezone)}</span>
              </p>
              <p className="mt-2 text-sm leading-relaxed break-words whitespace-pre-wrap">
                {lead.message || <span className="text-muted-foreground">(no message)</span>}
              </p>
              {custom.length > 0 ? (
                <dl className="mt-3 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_minmax(0,1fr)]">
                  {custom.map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt className="text-muted-foreground">{k}</dt>
                      <dd className="break-words">{typeof v === "string" ? v : JSON.stringify(v)}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
            </li>
            {thread.map((message) => (
              <ThreadItem
                key={message.id}
                message={message}
                offers={offers.get(message.id) ?? []}
                zone={zone}
                orgZone={org.timezone}
                leadName={displayName}
                autoOn={org.plan === "pro" && org.autonomy === "auto_high_score"}
                explanation={
                  message.status === "draft"
                    ? explainWait(
                        message,
                        { ...lead, scoreConfidence: lead.enrichment?.scoreConfidence ?? null },
                        org,
                      )
                    : null
                }
              />
            ))}
          </ol>
          {thread.length === 0 && lead.status === "new" ? (
            <p className="mt-3 rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
              No draft yet. Processing usually finishes within a minute; use Re-process if it seems stuck.
            </p>
          ) : null}
        </section>

        <aside className="grid content-start gap-4">
          <section aria-labelledby="score-title" className="rounded-2xl bg-card p-4 shadow-card ring-1 ring-foreground/10">
            <div className="flex items-center justify-between gap-2">
              <h2 id="score-title" className="font-heading text-lg">
                Score
              </h2>
              <Score score={lead.score} />
            </div>
            {enrichment.leadSummary ? <p className="mt-2 text-sm text-foreground/85">{enrichment.leadSummary}</p> : null}
            {lead.scoreReasons.length > 0 ? (
              <ul className="mt-3 grid gap-1.5">
                {lead.scoreReasons.map((reason, i) => {
                  const sign = signOf(reason);
                  return (
                    <li key={i} className="flex gap-2 text-sm">
                      <span
                        aria-hidden
                        className={cn(
                          "stopwatch w-3 shrink-0 font-semibold",
                          sign === "+" ? "text-sea" : sign === "−" ? "text-coral-ink" : "text-muted-foreground",
                        )}
                      >
                        {sign}
                      </span>
                      <span className="sr-only">{sign === "+" ? "In favour:" : sign === "−" ? "Against:" : "Note:"}</span>
                      <span className="min-w-0 break-words">{reason}</span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">Not scored yet.</p>
            )}
            {typeof enrichment.scoreConfidence === "number" ? (
              <p className="stopwatch mt-3 text-xs text-muted-foreground">
                Scorer confidence {Math.round(enrichment.scoreConfidence * 100)}%
              </p>
            ) : null}
          </section>

          <section aria-labelledby="company-title" className="rounded-2xl bg-card p-4 shadow-card ring-1 ring-foreground/10">
            <h2 id="company-title" className="flex items-center gap-2 font-heading text-lg">
              <Globe className="size-4 text-muted-foreground" aria-hidden />
              Company research
            </h2>
            {enrichment.error ? (
              <p className="mt-2 text-sm text-muted-foreground">
                Skipped{enrichment.domain ? ` for ${enrichment.domain}` : ""}: {enrichment.error}.
              </p>
            ) : enrichment.fetchedAt ? (
              <div className="mt-2 grid gap-2 text-sm">
                {enrichment.title ? <p className="font-semibold break-words">{enrichment.title}</p> : null}
                {enrichment.description ? <p className="break-words text-foreground/85">{enrichment.description}</p> : null}
                {enrichment.headings && enrichment.headings.length > 0 ? (
                  <p className="text-xs break-words text-muted-foreground">{enrichment.headings.slice(0, 5).join(" · ")}</p>
                ) : null}
                {enrichment.excerpt ? (
                  <details className="text-xs text-muted-foreground">
                    <summary className="cursor-pointer rounded-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
                      Page excerpt
                    </summary>
                    <p className="mt-1 break-words whitespace-pre-wrap">{enrichment.excerpt.slice(0, 1_500)}</p>
                  </details>
                ) : null}
                <p className="stopwatch text-xs text-muted-foreground">
                  {enrichment.domain} · read {enrichment.fetchedAt ? formatAgo(new Date(enrichment.fetchedAt), now) : ""}
                </p>
              </div>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">Not researched yet.</p>
            )}
            <p className="mt-3 text-xs text-muted-foreground">
              Website text is treated as data: the agent never follows instructions found in it.
            </p>
          </section>

          <section aria-labelledby="meetings-title" className="rounded-2xl bg-card p-4 shadow-card ring-1 ring-foreground/10">
            <h2 id="meetings-title" className="flex items-center gap-2 font-heading text-lg">
              <CalendarCheck className="size-4 text-sea" aria-hidden />
              Meetings
            </h2>
            {meetings.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">Nothing booked yet.</p>
            ) : (
              <ul className="mt-2 grid gap-2">
                {meetings.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span className="stopwatch">{formatDateTime(m.startsAt, org.timezone)}</span>
                    <span className="flex items-center gap-2">
                      <Pill tone={m.status === "booked" ? "sea" : "quiet"}>{m.status.replace("_", "-")}</Pill>
                      <a
                        href={`/b/${org.bookingSlug}/ics/${m.id}`}
                        className="inline-flex items-center gap-1 rounded-sm text-coral-ink underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                      >
                        <Download className="size-3.5" aria-hidden />
                        .ics
                      </a>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="log-title" className="rounded-2xl bg-card p-4 shadow-card ring-1 ring-foreground/10">
            <h2 id="log-title" className="flex items-center gap-2 font-heading text-lg">
              <Sparkles className="size-4 text-coral" aria-hidden />
              Agent log
            </h2>
            {events.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">No events yet.</p>
            ) : (
              <ol className="mt-2 grid gap-1.5">
                {events.map((e) => (
                  <li key={e.id} className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="min-w-0 break-words">{e.type.replace(/[._]/g, " ")}</span>
                    <span className="stopwatch shrink-0 text-xs text-muted-foreground">
                      {e.model ? `${e.model} · ` : ""}
                      {formatAgo(e.createdAt, now)}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </aside>
      </div>
    </>
  );
}

function ThreadItem({
  message,
  offers,
  zone,
  orgZone,
  leadName,
  explanation,
  autoOn,
}: {
  autoOn: boolean;
  message: Message;
  offers: SlotOffer[];
  zone: string;
  orgZone: string;
  leadName: string;
  explanation: ReturnType<typeof explainWait> | null;
}) {
  const inbound = message.direction === "in";
  const c = message.classification;
  return (
    <li
      className={cn(
        "rounded-2xl p-4 ring-1",
        inbound ? "bg-card ring-foreground/10" : "border-l-4 bg-card ring-foreground/10",
        !inbound && message.status === "draft" && "border-l-lemon",
        !inbound && message.status === "sent" && "border-l-sea",
        !inbound && message.status === "rejected" && "border-l-foreground/20 opacity-75",
        !inbound && message.status === "approved" && "border-l-coral",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-foreground/70">
          {inbound ? `From ${leadName}` : KIND_LABEL[message.kind]}
        </span>
        {inbound ? <Pill tone="outline">Reply</Pill> : <MessageStatusPill status={message.status} />}
        {message.simulated ? <Pill tone="quiet">Simulated</Pill> : null}
        <span className="stopwatch ml-auto text-xs text-muted-foreground">
          {formatDateTime(message.sentAt ?? message.createdAt, orgZone)}
        </span>
      </div>

      {message.status === "draft" ? (
        <div className="mt-3 grid gap-3">
          {explanation ? <WaitReasons explanation={explanation} showProHint={!autoOn} /> : null}
          <DraftReview messageId={message.id} subject={message.subject} body={message.body} leadName={leadName} />
        </div>
      ) : (
        <>
          {message.subject ? <p className="mt-2 text-sm font-semibold break-words">{message.subject}</p> : null}
          <p className="mt-1 text-sm leading-relaxed break-words whitespace-pre-wrap text-foreground/90">{message.body}</p>
        </>
      )}

      {!inbound && offers.length > 0 ? (
        <div className="mt-3">
          <p className="text-xs font-semibold text-foreground/70">Times offered ({zone})</p>
          <ul className="mt-1.5 grid gap-1.5">
            {offers.map((o) => (
              <li
                key={o.id}
                className="stopwatch flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-1.5 text-xs"
              >
                <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-sea" />
                {formatSlotFor({ start: o.startsAt, end: o.endsAt }, zone)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {!inbound && message.rationale && message.status !== "draft" ? (
        <p className="mt-3 text-xs text-muted-foreground">Notes: {message.rationale}</p>
      ) : null}

      {inbound && c ? (
        <div className="mt-3 rounded-xl bg-muted p-3 text-sm">
          <p className="flex flex-wrap items-center gap-2">
            <Pill tone={c.intent === "accepts_slot" ? "sea" : c.intent === "not_interested" ? "quiet" : "lemon"}>
              {INTENT_LABEL[c.intent] ?? c.intent}
            </Pill>
            {typeof c.confidence === "number" ? (
              <span className="stopwatch text-xs text-muted-foreground">{Math.round(c.confidence * 100)}% sure</span>
            ) : null}
            {c.classifier === "fallback" ? <span className="text-xs text-muted-foreground">(keyword rules)</span> : null}
          </p>
          {c.summary ? <p className="mt-1.5 break-words">{c.summary}</p> : null}
          {c.followUpAt ? (
            <p className="stopwatch mt-1.5 text-xs text-muted-foreground">
              {c.followUpDoneAt ? "Follow-up drafted" : "Follow-up scheduled"} for {formatDateTime(new Date(c.followUpAt), orgZone)}
            </p>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
