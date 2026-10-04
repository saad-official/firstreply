import type { Metadata } from "next";
import Link from "next/link";
import { Download } from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";
import { MeetingStatusButtons } from "@/components/app/meeting-status-buttons";
import { PageHeader } from "@/components/app/page-header";
import { Pill } from "@/components/app/pills";
import { Button } from "@/components/ui/button";
import { requireOrgContext } from "@/lib/auth/session";
import * as leadsRepo from "@/lib/db/repositories/leads";
import * as meetingsRepo from "@/lib/db/repositories/meetings";
import type { Lead, Meeting } from "@/lib/db/types";
import { formatDate, formatTime } from "@/lib/format";

export const metadata: Metadata = { title: "Meetings" };

const DAY_MS = 86_400_000;
const STATUS_TEXT: Record<Meeting["status"], string> = {
  booked: "Booked",
  held: "Held",
  no_show: "No-show",
  cancelled: "Cancelled",
};

function MeetingRow({
  meeting,
  lead,
  timezone,
  bookingSlug,
  past,
}: {
  meeting: Meeting;
  lead: Lead | null;
  timezone: string;
  bookingSlug: string;
  past: boolean;
}) {
  const name = lead?.name ?? lead?.email ?? "Lead";
  const label = `the meeting with ${name}`;
  return (
    <li className="grid gap-3 rounded-2xl bg-card p-4 ring-1 ring-foreground/10 sm:grid-cols-[8.5rem_minmax(0,1fr)_auto] sm:items-center">
      <div>
        <p className="stopwatch text-2xl leading-none">{formatTime(meeting.startsAt, timezone)}</p>
        <p className="mt-1 text-xs text-muted-foreground">{formatDate(meeting.startsAt, timezone)}</p>
      </div>
      <div className="min-w-0">
        <p className="truncate font-semibold">
          {lead ? (
            <Link href={`/leads/${lead.id}`} className="rounded-sm outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50">
              {name}
            </Link>
          ) : (
            name
          )}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {[lead?.company, lead?.email].filter(Boolean).join(" · ")} ·{" "}
          <span className="stopwatch">
            {Math.round((meeting.endsAt.getTime() - meeting.startsAt.getTime()) / 60_000)} min
          </span>
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        <Pill tone={meeting.status === "booked" ? "sea" : meeting.status === "held" ? "night" : "quiet"}>
          {STATUS_TEXT[meeting.status]}
        </Pill>
        {meeting.status !== "cancelled" ? (
          <Button variant="ghost" size="sm" asChild>
            <a href={`/b/${bookingSlug}/ics/${meeting.id}`} aria-label={`Download the calendar invite for ${label}`}>
              <Download aria-hidden />
              .ics
            </a>
          </Button>
        ) : null}
        {meeting.status === "booked" ? <MeetingStatusButtons meetingId={meeting.id} past={past} label={label} /> : null}
      </div>
    </li>
  );
}

export default async function MeetingsPage() {
  const { org } = await requireOrgContext();
  const now = new Date();
  const [upcoming, recent] = await Promise.all([
    meetingsRepo.listForOrg(org.id, { from: now, limit: 100 }),
    meetingsRepo.listForOrg(org.id, { from: new Date(now.getTime() - 60 * DAY_MS), to: now, limit: 200 }),
  ]);
  const past = recent.reverse();
  const leadIds = [...new Set([...upcoming, ...past].map((m) => m.leadId))];
  const leads = new Map(
    (await Promise.all(leadIds.map((id) => leadsRepo.getById(org.id, id))))
      .filter((l): l is Lead => l !== null)
      .map((l) => [l.id, l]),
  );
  const noShows = past.filter((m) => m.status === "no_show").length;
  const decided = past.filter((m) => m.status === "held" || m.status === "no_show").length;

  return (
    <>
      <PageHeader
        title="Meetings"
        description={`Times shown in ${org.timezone}. Mark past meetings held or no-show to keep the no-show rate honest.`}
        actions={
          decided > 0 ? (
            <p className="stopwatch text-sm text-muted-foreground">
              No-show rate {Math.round((noShows / decided) * 100)}% ({noShows}/{decided})
            </p>
          ) : null
        }
      />

      <section aria-labelledby="upcoming-title">
        <h2 id="upcoming-title" className="font-heading text-xl">
          Upcoming
        </h2>
        {upcoming.length === 0 ? (
          <EmptyState
            className="mt-3 py-10"
            title="Nothing booked yet"
            description="When a lead accepts a time, or books on your booking page, the meeting appears here with its calendar invite."
            action={
              <Button variant="outline" asChild>
                <a href={`/b/${org.bookingSlug}`} target="_blank" rel="noreferrer">
                  Open your booking page
                </a>
              </Button>
            }
          />
        ) : (
          <ol className="mt-3 grid gap-2">
            {upcoming.map((m) => (
              <MeetingRow
                key={m.id}
                meeting={m}
                lead={leads.get(m.leadId) ?? null}
                timezone={org.timezone}
                bookingSlug={org.bookingSlug}
                past={false}
              />
            ))}
          </ol>
        )}
      </section>

      <section aria-labelledby="past-title" className="mt-10">
        <h2 id="past-title" className="font-heading text-xl">
          Past 60 days
        </h2>
        {past.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No past meetings.</p>
        ) : (
          <ol className="mt-3 grid gap-2">
            {past.map((m) => (
              <MeetingRow
                key={m.id}
                meeting={m}
                lead={leads.get(m.leadId) ?? null}
                timezone={org.timezone}
                bookingSlug={org.bookingSlug}
                past
              />
            ))}
          </ol>
        )}
      </section>
    </>
  );
}
