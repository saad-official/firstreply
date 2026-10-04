import type { Metadata } from "next";
import Link from "next/link";
import { DraftReview } from "@/components/app/draft-review";
import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { FitPill, KIND_LABEL, Pill, Score } from "@/components/app/pills";
import { WaitReasons } from "@/components/app/wait-reasons";
import { Button } from "@/components/ui/button";
import { requireOrgContext } from "@/lib/auth/session";
import * as leadsRepo from "@/lib/db/repositories/leads";
import * as messagesRepo from "@/lib/db/repositories/messages";
import { formatDuration, secondsBetween } from "@/lib/format";
import { explainWait } from "@/lib/services/queue-reasons";

export const metadata: Metadata = { title: "Queue" };
export const maxDuration = 60;

export default async function QueuePage() {
  const { org } = await requireOrgContext();
  const items = await messagesRepo.listQueue(org.id, { limit: 100 });
  const leads = await Promise.all(items.map((i) => leadsRepo.getById(org.id, i.lead.id)));
  const now = new Date();
  const autoOn = org.plan === "pro" && org.autonomy === "auto_high_score";

  return (
    <>
      <PageHeader
        title="Queue"
        description={
          autoOn
            ? "Drafts that did not qualify for auto-reply. Oldest lead first: the clock is running."
            : "Every drafted reply waits here for you. Oldest lead first: the clock is running."
        }
        actions={
          !autoOn ? (
            <Button variant="outline" asChild>
              <Link href={org.plan === "pro" ? "/settings#autonomy" : "/billing"}>
                {org.plan === "pro" ? "Turn on auto-reply" : "Auto-reply with Pro"}
              </Link>
            </Button>
          ) : null
        }
      />

      {items.length === 0 ? (
        <EmptyState
          title="Nothing waiting"
          description="New drafts land here within a minute of a lead arriving. Replies you approve go out straight away."
          action={
            <Button variant="outline" asChild>
              <Link href="/leads">See all leads</Link>
            </Button>
          }
        />
      ) : (
        <ol className="grid gap-4">
          {items.map(({ message, lead }, index) => {
            const full = leads[index];
            const explanation = explainWait(
              message,
              { ...lead, scoreConfidence: full?.enrichment?.scoreConfidence ?? null },
              org,
            );
            const name = lead.name ?? lead.email;
            const waited = secondsBetween(lead.createdAt, now);
            return (
              <li key={message.id}>
                <article
                  aria-labelledby={`q-${message.id}`}
                  className="grid gap-4 rounded-2xl bg-card p-4 shadow-card ring-1 ring-foreground/10 sm:p-5 lg:grid-cols-[minmax(0,4fr)_minmax(0,7fr)]"
                >
                  <div className="min-w-0 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h2 id={`q-${message.id}`} className="truncate font-heading text-lg">
                          <Link href={`/leads/${lead.id}`} className="rounded-sm outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50">
                            {name}
                          </Link>
                        </h2>
                        <p className="truncate text-xs text-muted-foreground">{lead.company ?? lead.email}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="stopwatch text-2xl leading-none text-coral-ink">{formatDuration(waited)}</p>
                        <p className="text-[0.7rem] text-muted-foreground">waiting</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Pill tone="lemon">{KIND_LABEL[message.kind]}</Pill>
                      <FitPill fit={lead.fit} />
                      <Score score={lead.score} />
                    </div>
                    <WaitReasons explanation={explanation} showProHint={!autoOn} />
                    {lead.message ? (
                      <details className="text-sm">
                        <summary className="cursor-pointer rounded-sm text-xs font-semibold text-foreground/75 outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
                          Their message
                        </summary>
                        <p className="mt-1.5 break-words whitespace-pre-wrap text-foreground/85">{lead.message}</p>
                      </details>
                    ) : null}
                    {message.rationale ? (
                      <p className="text-xs break-words text-muted-foreground">Notes: {message.rationale}</p>
                    ) : null}
                  </div>
                  <div className="min-w-0">
                    <DraftReview messageId={message.id} subject={message.subject} body={message.body} leadName={name} />
                  </div>
                </article>
              </li>
            );
          })}
        </ol>
      )}
    </>
  );
}
