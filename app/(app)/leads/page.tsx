import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { FitPill, Score, STATUS_LABEL, StatusPill } from "@/components/app/pills";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireOrgContext } from "@/lib/auth/session";
import * as leadsRepo from "@/lib/db/repositories/leads";
import * as metricsRepo from "@/lib/db/repositories/metrics";
import { LEAD_STATUSES } from "@/lib/db/schema";
import type { Lead, LeadStatus } from "@/lib/db/types";
import { formatAgo, formatDuration, secondsBetween } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Leads" };

function isStatus(value: unknown): value is LeadStatus {
  return typeof value === "string" && (LEAD_STATUSES as readonly string[]).includes(value);
}

/** First-response time, or how long a lead has been waiting for one. */
function Response({ lead, now }: { lead: Lead; now: Date }) {
  if (lead.firstReplyAt) {
    const s = secondsBetween(lead.createdAt, lead.firstReplyAt);
    return (
      <span className={cn("stopwatch text-sm", s <= 60 && "text-sea")}>
        {formatDuration(s)}
      </span>
    );
  }
  if (lead.status === "new") {
    return (
      <span className="stopwatch text-sm text-coral-ink" title="Waiting for a first reply">
        waiting {formatDuration(secondsBetween(lead.createdAt, now))}
      </span>
    );
  }
  return <span className="text-sm text-muted-foreground">–</span>;
}

function sourceText(lead: Lead): string {
  return lead.sourceLabel ?? lead.source;
}

export default async function LeadsPage({ searchParams }: PageProps<"/leads">) {
  const { org } = await requireOrgContext();
  const params = await searchParams;
  const status = isStatus(params.status) ? params.status : undefined;
  const [leads, counts] = await Promise.all([
    leadsRepo.listForOrg(org.id, { status, limit: 200 }),
    metricsRepo.countsByStatus(org.id),
  ]);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const now = new Date();
  const filters: Array<{ value: LeadStatus | undefined; label: string; count: number }> = [
    { value: undefined, label: "All", count: total },
    ...LEAD_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s], count: counts[s] })),
  ];

  return (
    <>
      <PageHeader
        title="Leads"
        description="Every enquiry, newest first: score against your rubric, how fast it was answered, and where it stands."
      />

      <nav aria-label="Filter by status" className="-mx-1 mb-4 flex flex-wrap gap-1.5">
        {filters.map((f) => {
          const active = f.value === status;
          return (
            <Link
              key={f.label}
              href={f.value ? `/leads?status=${f.value}` : "/leads"}
              aria-current={active ? "page" : undefined}
              className={cn(
                "pill border outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
                active
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-card text-foreground/80 hover:bg-accent",
              )}
            >
              {f.label}
              <span className="stopwatch text-[0.7rem] opacity-75">{f.count}</span>
            </Link>
          );
        })}
      </nav>

      {leads.length === 0 ? (
        <EmptyState
          title={status ? `No ${STATUS_LABEL[status].toLowerCase()} leads` : "No leads yet"}
          description={
            status
              ? "Try another filter."
              : "Leads arrive from your hosted form, a provider webhook, or the demo workspace on the dashboard."
          }
          action={
            status ? (
              <Button variant="outline" asChild>
                <Link href="/leads">Show all leads</Link>
              </Button>
            ) : (
              <Button asChild>
                <Link href="/dashboard">Go to the dashboard</Link>
              </Button>
            )
          }
        />
      ) : (
        <>
          {/* Phones: one card per lead. */}
          <ul className="grid gap-2 md:hidden">
            {leads.map((lead) => (
              <li key={lead.id} className="min-w-0">
                <Link
                  href={`/leads/${lead.id}`}
                  className="block rounded-xl bg-card p-3 ring-1 ring-foreground/10 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <span className="flex items-start justify-between gap-2">
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{lead.name ?? lead.email}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {lead.company ?? lead.email} · {sourceText(lead)}
                      </span>
                    </span>
                    <StatusPill status={lead.status} className="shrink-0" />
                  </span>
                  <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <Score score={lead.score} />
                    <FitPill fit={lead.fit} />
                    <Response lead={lead} now={now} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>

          {/* Tablet and up: the pipeline table. */}
          <div className="hidden overflow-hidden rounded-2xl bg-card shadow-card ring-1 ring-foreground/10 md:block">
            <Table>
              <caption className="sr-only">Leads{status ? ` with status ${STATUS_LABEL[status]}` : ""}</caption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Lead</TableHead>
                  <TableHead scope="col">Status</TableHead>
                  <TableHead scope="col">Score</TableHead>
                  <TableHead scope="col">Fit</TableHead>
                  <TableHead scope="col" className="hidden lg:table-cell">
                    Source
                  </TableHead>
                  <TableHead scope="col">First response</TableHead>
                  <TableHead scope="col" className="text-right">
                    Received
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {leads.map((lead) => (
                  <TableRow key={lead.id} className="relative">
                    <TableCell className="max-w-64">
                      <Link
                        href={`/leads/${lead.id}`}
                        className="block truncate font-semibold outline-none after:absolute after:inset-0 hover:underline focus-visible:underline"
                      >
                        {lead.name ?? lead.email}
                      </Link>
                      <span className="block truncate text-xs text-muted-foreground">{lead.company ?? lead.email}</span>
                    </TableCell>
                    <TableCell>
                      <StatusPill status={lead.status} />
                    </TableCell>
                    <TableCell>
                      <Score score={lead.score} />
                    </TableCell>
                    <TableCell>
                      <FitPill fit={lead.fit} />
                    </TableCell>
                    <TableCell className="hidden max-w-40 truncate text-sm text-muted-foreground lg:table-cell">
                      {sourceText(lead)}
                    </TableCell>
                    <TableCell>
                      <Response lead={lead} now={now} />
                    </TableCell>
                    <TableCell className="stopwatch text-right text-xs text-muted-foreground">
                      {formatAgo(lead.createdAt, now)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </>
  );
}
