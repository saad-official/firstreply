import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CalendarCheck, Inbox, Webhook } from "lucide-react";
import { DemoWorkspaceButton } from "@/components/app/demo-workspace-button";
import { PageHeader } from "@/components/app/page-header";
import { FitPill, KIND_LABEL, STATUS_LABEL } from "@/components/app/pills";
import { StopwatchDial } from "@/components/marketing/mocks/stopwatch";
import { Button } from "@/components/ui/button";
import { requireOrgContext } from "@/lib/auth/session";
import type { LeadStatus } from "@/lib/db/types";
import { formatAgo, formatDateTime, formatDuration, formatStopwatch, percent, secondsBetween } from "@/lib/format";
import { BENCHMARK_SECONDS, getDashboard, RESPONSE_WINDOW_DAYS } from "@/lib/services/metrics";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Dashboard" };
/** Loading the demo runs six leads through the pipeline inside the server action. */
export const maxDuration = 60;

const PIPELINE: LeadStatus[] = ["new", "replied", "negotiating", "booked", "declined", "spam"];
const PIPELINE_TONE: Partial<Record<LeadStatus, string>> = {
  new: "bg-coral",
  replied: "bg-foreground/45",
  negotiating: "bg-lemon",
  booked: "bg-sea",
};

function Tile({
  label,
  value,
  caption,
  href,
  tone,
}: {
  label: string;
  value: string;
  caption: string;
  href?: string;
  tone?: "lemon" | "sea";
}) {
  const body = (
    <>
      <span className="text-xs font-semibold text-foreground/75">{label}</span>
      <span
        className={cn(
          "stopwatch mt-3 text-4xl leading-none",
          tone === "sea" && "text-sea",
          tone === "lemon" && "text-lemon-foreground dark:text-lemon",
        )}
      >
        {value}
      </span>
      <span className="mt-2 text-xs text-foreground/70">{caption}</span>
    </>
  );
  const className = cn(
    "flex min-w-0 flex-col rounded-2xl bg-card p-4 shadow-card ring-1 ring-foreground/10",
    tone === "lemon" && "ring-lemon",
    href && "transition-colors outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50",
  );
  return href ? (
    <Link href={href} className={className}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

export default async function DashboardPage() {
  const { org } = await requireOrgContext();
  const now = new Date();
  const d = await getDashboard(org, now);
  const median = d.medianFirstResponseSeconds;
  // Drawn to scale against the 47-hour benchmark (a sliver, on purpose), with a visible minimum.
  const benchShare = median === null ? 0 : Math.min(1, median / BENCHMARK_SECONDS);

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={`Response times over the last ${RESPONSE_WINDOW_DAYS} days; pipeline over the last 7.`}
      />

      {!d.hasLeads ? (
        <section
          aria-labelledby="empty-title"
          className="dotgrid mb-8 grid gap-6 rounded-2xl border border-dashed border-foreground/15 bg-card/70 p-6 md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:p-8"
        >
          <div className="space-y-2">
            <h2 id="empty-title" className="font-heading text-2xl">
              No leads yet
            </h2>
            <p className="max-w-xl text-sm text-muted-foreground">
              Connect your form or a webhook and the first lead gets a personal reply with three real times in under a
              minute. Or load the demo workspace: six fictional leads (one high fit, one asking about price, one spam,
              one out of office) run through the real pipeline so the queue fills straight away.
            </p>
            <div className="flex flex-wrap gap-2 pt-2">
              <Button variant="outline" asChild>
                <Link href="/settings#forms">
                  <Inbox aria-hidden />
                  Set up a hosted form
                </Link>
              </Button>
              <Button variant="ghost" asChild>
                <Link href="/settings#webhooks">
                  <Webhook aria-hidden />
                  Connect Typeform, Tally, Webflow or Framer
                </Link>
              </Button>
            </div>
          </div>
          <DemoWorkspaceButton />
        </section>
      ) : null}

      <section aria-labelledby="speed-title" className="grid gap-3 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="relative min-w-0 overflow-hidden rounded-2xl bg-night p-5 text-cream shadow-card sm:p-6 dark:bg-card dark:text-foreground">
          <h2 id="speed-title" className="text-sm font-semibold text-cream/80 dark:text-foreground/80">
            Median first reply
          </h2>
          <div className="mt-4 flex items-center gap-4">
            <StopwatchDial
              className="size-16 text-cream sm:size-20 dark:text-foreground"
              seconds={median === null ? 0 : Math.min(59.5, median)}
            />
            <p className="stopwatch min-w-0 text-5xl leading-none text-coral sm:text-6xl">{formatStopwatch(median)}</p>
          </div>
          <p className="mt-3 text-sm text-cream/75 dark:text-foreground/75">
            {median === null
              ? "Nothing sent yet. Approve a draft and the clock starts."
              : `From lead received to reply sent, across ${d.repliedCount} ${d.repliedCount === 1 ? "lead" : "leads"}.`}
          </p>
          <div aria-hidden className="mt-5 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5">
            <span className="stopwatch text-[0.6875rem] text-cream/75 dark:text-foreground/75">You</span>
            <span className="block h-1.5 w-full rounded-full bg-transparent">
              <span
                className="block h-full rounded-full bg-coral"
                style={{ width: `max(2px, ${(benchShare * 100).toFixed(3)}%)` }}
              />
            </span>
            <span className="stopwatch text-[0.6875rem] text-cream/75 dark:text-foreground/75">47 h</span>
            <span className="block h-1.5 w-full rounded-full bg-cream/30 dark:bg-foreground/25" />
          </div>
          <p className="mt-2 text-xs text-cream/60 dark:text-foreground/60">
            The average small business takes about 47 hours to answer a lead.
          </p>
        </div>

        <div className="grid min-w-0 grid-cols-2 gap-3">
          <Tile
            label="Leads this week"
            value={String(d.leadsThisWeek)}
            caption={
              d.usage.limit === null
                ? "Unlimited on Pro"
                : `${d.usage.leadsThisMonth} of ${d.usage.limit} used this month`
            }
            href="/leads"
          />
          <Tile
            label="Replied under 60 s"
            value={percent(d.under60Rate)}
            caption={d.repliedCount > 0 ? `${d.repliedUnder60s} of ${d.repliedCount} replies` : "No replies yet"}
            tone="sea"
          />
          <Tile
            label="Meetings booked"
            value={String(d.meetingsBookedThisWeek)}
            caption="Last 7 days"
            href="/meetings"
            tone="sea"
          />
          <Tile
            label="Awaiting approval"
            value={String(d.awaitingApproval)}
            caption={d.awaitingApproval > 0 ? "Open the queue" : "Queue is clear"}
            href="/queue"
            tone={d.awaitingApproval > 0 ? "lemon" : undefined}
          />
        </div>
      </section>

      {d.leadsThisWeek > 0 ? (
        <section aria-labelledby="pipeline-title" className="mt-3 rounded-2xl bg-card p-4 shadow-card ring-1 ring-foreground/10">
          <h2 id="pipeline-title" className="text-xs font-semibold text-foreground/75">
            This week&rsquo;s pipeline
          </h2>
          <div aria-hidden className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-foreground/10">
            {PIPELINE.map((s) =>
              d.byStatus[s] > 0 ? (
                <span
                  key={s}
                  className={cn("h-full", PIPELINE_TONE[s] ?? "bg-foreground/20")}
                  style={{ width: `${(d.byStatus[s] / d.leadsThisWeek) * 100}%` }}
                />
              ) : null,
            )}
          </div>
          <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-sm">
            {PIPELINE.map((s) => (
              <li key={s}>
                <Link href={`/leads?status=${s}`} className="rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50">
                  <span className="text-muted-foreground">{STATUS_LABEL[s]}</span>{" "}
                  <span className="stopwatch">{d.byStatus[s]}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="mt-8 grid gap-8 lg:grid-cols-2">
        <section aria-labelledby="next-title" className="min-w-0">
          <div className="flex items-center justify-between gap-2">
            <h2 id="next-title" className="font-heading text-xl">
              Next up
            </h2>
            <Link href="/queue" className="inline-flex items-center gap-1 text-sm font-medium text-coral-ink hover:underline">
              Queue <ArrowRight className="size-4" aria-hidden />
            </Link>
          </div>
          {d.nextUp.length === 0 && d.upcomingMeetings.length === 0 ? (
            <p className="mt-3 rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
              Nothing waiting on you. New drafts land in the queue within a minute of a lead arriving.
            </p>
          ) : (
            <ul className="mt-3 grid gap-2">
              {d.nextUp.map(({ message, lead }) => (
                <li key={message.id} className="min-w-0">
                  <Link
                    href={`/leads/${lead.id}`}
                    className="flex items-center gap-3 rounded-xl bg-card p-3 ring-1 ring-foreground/10 transition-colors outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    <span aria-hidden className="size-2 shrink-0 rounded-full bg-lemon" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{lead.name ?? lead.email}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {KIND_LABEL[message.kind]} awaiting approval{lead.company ? ` · ${lead.company}` : ""}
                      </span>
                    </span>
                    <FitPill fit={lead.fit} className="hidden sm:inline-flex" />
                    <span className="stopwatch shrink-0 text-xs text-muted-foreground" title="Waiting since the lead arrived">
                      {formatDuration(secondsBetween(lead.createdAt, now))}
                    </span>
                  </Link>
                </li>
              ))}
              {d.upcomingMeetings.map((m) => (
                <li key={m.id} className="min-w-0">
                  <Link
                    href={`/leads/${m.leadId}`}
                    className="flex items-center gap-3 rounded-xl bg-card p-3 ring-1 ring-foreground/10 transition-colors outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    <CalendarCheck className="size-4 shrink-0 text-sea" aria-hidden />
                    <span className="min-w-0 flex-1 text-sm font-semibold">Meeting</span>
                    <span className="stopwatch shrink-0 text-xs">{formatDateTime(m.startsAt, org.timezone)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="activity-title" className="min-w-0">
          <h2 id="activity-title" className="font-heading text-xl">
            Agent activity
          </h2>
          {d.activity.length === 0 ? (
            <p className="mt-3 rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
              Every score, draft, send and booking is logged here.
            </p>
          ) : (
            <ol className="mt-3 grid gap-0 border-l border-border pl-4">
              {d.activity.map((a) => (
                <li key={a.id} className="relative py-1.5">
                  <span
                    aria-hidden
                    className={cn(
                      "absolute top-3 -left-[1.3rem] size-2 rounded-full ring-2 ring-background",
                      a.actor === "user" ? "bg-foreground" : a.actor === "agent" ? "bg-coral" : "bg-sea",
                    )}
                  />
                  <p className="text-sm">
                    {a.href ? (
                      <Link href={a.href} className="underline-offset-4 hover:underline">
                        {a.text}
                      </Link>
                    ) : (
                      a.text
                    )}
                  </p>
                  <p className="stopwatch text-xs text-muted-foreground">
                    {formatAgo(a.at, now)} · {a.actor}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </>
  );
}
