import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { PublicCard, PublicShell } from "@/components/public/public-shell";
import { getBookingPage } from "@/lib/services/booking";
import { BookingFlow } from "./booking-flow";

/**
 * Public booking page /b/<slug> (spec 3.3): the org's free slots for the
 * next business days, shown in the visitor's zone (?tz=, set from the
 * browser on first visit), and a short confirm form that books one.
 */

const loadPage = cache((slug: string, tz: string | null) => getBookingPage(slug, { timezone: tz }));

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function zoneParam(value: string | string[] | undefined): string | null {
  const tz = first(value)?.trim();
  return tz && tz.length <= 64 ? tz : null;
}

export async function generateMetadata({ params, searchParams }: PageProps<"/b/[slug]">): Promise<Metadata> {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const page = await loadPage(slug, zoneParam(query.tz));
  return {
    title: page ? `Book with ${page.org.name}` : "Booking page not found",
    robots: { index: false, follow: false },
  };
}

export default async function BookingPage({ params, searchParams }: PageProps<"/b/[slug]">) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const tz = zoneParam(query.tz);
  const page = await loadPage(slug, tz);
  if (!page) notFound();
  const { org } = page;

  return (
    <PublicShell width="lg">
      <PublicCard>
        <header>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-foreground/75">
            <span className="pill bg-foreground text-background">
              <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className="size-3.5">
                <circle cx="8" cy="9" r="5.25" stroke="currentColor" strokeWidth="1.5" />
                <path d="M8 6.5V9l1.75 1.25M6.5 2h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              <span className="stopwatch">{org.meetingLengthMinutes} min</span>
            </span>
            <span>with {org.name}</span>
          </p>
          <h1 className="mt-4 text-[1.75rem] leading-[1.1] text-balance break-words sm:text-4xl">
            Book {org.offer} with {org.name}
          </h1>
          <p className="mt-3 text-[0.9375rem] leading-relaxed text-foreground/75">
            Pick a time that suits you. The invite lands in your inbox as soon as you confirm.
          </p>
        </header>

        <BookingFlow
          slug={org.bookingSlug}
          orgName={org.name}
          timezone={page.timezone}
          hasZoneParam={tz !== null && page.timezone === tz}
          meetingLengthMinutes={org.meetingLengthMinutes}
          days={page.days}
        />
      </PublicCard>
    </PublicShell>
  );
}
