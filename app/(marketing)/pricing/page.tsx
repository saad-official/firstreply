import type { Metadata } from "next";
import { cn } from "@/lib/utils";
import { CtaLink } from "@/components/marketing/cta-link";
import { PricingPlans } from "@/components/marketing/pricing-plans";
import { SectionLabel } from "@/components/marketing/section-label";
import { container, links } from "@/components/marketing/site";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Free for 25 leads a month with every reply approved by you. Pro is $39 a month for unlimited leads, auto-reply for high-fit leads, a weekly report and Slack or webhook notifications.",
  alternates: { canonical: "/pricing" },
};

type Cell = string | boolean;

const rows: { feature: string; free: Cell; pro: Cell; note?: string }[] = [
  { feature: "Leads a month", free: "25", pro: "Unlimited" },
  { feature: "Hosted lead form and embed snippet", free: true, pro: true },
  { feature: "Webhook for Typeform, Tally, Webflow, Framer", free: true, pro: true },
  { feature: "Scoring against your rubric, with reasons", free: true, pro: true },
  { feature: "Replies with three real slots", free: true, pro: true },
  { feature: "Reading replies and booking", free: true, pro: true },
  { feature: "Booking page and .ics invites", free: true, pro: true },
  { feature: "Approval queue", free: true, pro: true },
  {
    feature: "Auto-reply for high-fit leads",
    free: false,
    pro: true,
    note: "Score 70 or more and confidence 0.8 or more. Declines and pricing questions always wait.",
  },
  { feature: "Weekly report email", free: false, pro: true },
  { feature: "Slack and webhook notifications", free: false, pro: true },
  { feature: "Google Calendar sync", free: false, pro: "Planned" },
];

function CellValue({ value }: { value: Cell }) {
  if (value === true) {
    return (
      <>
        <span aria-hidden="true" className="inline-block size-2 rounded-full bg-sea" />
        <span className="sr-only">Included</span>
      </>
    );
  }
  if (value === false) {
    return (
      <>
        <span aria-hidden="true" className="text-foreground/60">
          &ndash;
        </span>
        <span className="sr-only">Not included</span>
      </>
    );
  }
  return <span className="stopwatch">{value}</span>;
}

const billing = [
  {
    q: "Is this a real subscription?",
    a: "Not on this demo. Stripe runs in test mode, so checkout accepts only Stripe's published test cards and no money moves.",
  },
  {
    q: "Does Pro include Google Calendar sync?",
    a: "Not yet. Both plans book against the availability you set in Firstreply and send .ics invites. Calendar sync, with your busy times, is the next thing on the list for Pro.",
  },
  {
    q: "Is Pro priced per seat?",
    a: "No. It is one flat price per workspace. Speed-to-lead tools built for sales teams charge per rep and assume a CRM; a five-person studio with one shared inbox should not need either.",
  },
];

export default function PricingPage() {
  return (
    <>
      <section aria-labelledby="pricing-title" className="dotgrid border-b border-border">
        <div className={cn(container, "py-14 sm:py-20")}>
          <SectionLabel>Pricing</SectionLabel>
          <h1 id="pricing-title" className="mt-4 max-w-3xl text-4xl leading-tight text-balance sm:text-5xl lg:text-6xl">
            Start free. Pay when it answers on its own.
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-foreground/80">
            Both plans do the whole job: capture, score, reply with real slots, read the answer and book. Pro adds
            auto-reply for the leads you would never turn away, and takes the cap off.
          </p>
          <div className="mt-10">
            <PricingPlans headingLevel="h2" />
          </div>
        </div>
      </section>

      <section aria-labelledby="compare-title">
        <div className={cn(container, "py-16 sm:py-20")}>
          <h2 id="compare-title" className="text-3xl">
            Compare plans
          </h2>
          <div className="mt-8 overflow-hidden rounded-2xl bg-card ring-1 ring-foreground/10">
            <table className="w-full table-fixed border-collapse text-left text-sm sm:text-[0.9375rem]">
              <caption className="sr-only">Features included in the Free and Pro plans</caption>
              <colgroup>
                <col />
                <col className="w-20 sm:w-36" />
                <col className="w-24 sm:w-36" />
              </colgroup>
              <thead>
                <tr className="border-b border-border">
                  <th scope="col" className="px-4 py-3 font-semibold sm:px-5">
                    Feature
                  </th>
                  <th scope="col" className="px-2 py-3 font-semibold sm:px-5">
                    Free
                  </th>
                  <th scope="col" className="px-2 py-3 font-semibold sm:px-5">
                    Pro
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.feature} className="border-b border-border last:border-b-0">
                    <th scope="row" className="px-4 py-3 align-top font-normal break-words sm:px-5">
                      {r.feature}
                      {r.note ? <span className="mt-1 block text-xs text-foreground/75">{r.note}</span> : null}
                    </th>
                    <td className="px-2 py-3 align-top sm:px-5">
                      <CellValue value={r.free} />
                    </td>
                    <td className="px-2 py-3 align-top sm:px-5">
                      <CellValue value={r.pro} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section aria-labelledby="billing-title" className="border-t border-border">
        <div className={cn(container, "grid gap-10 py-16 sm:py-20 lg:grid-cols-12")}>
          <h2 id="billing-title" className="text-3xl lg:col-span-4">
            Billing questions
          </h2>
          <dl className="space-y-8 lg:col-span-8">
            {billing.map((b) => (
              <div key={b.q}>
                <dt className="font-heading text-xl font-bold">{b.q}</dt>
                <dd className="mt-2 max-w-2xl text-[0.9375rem] leading-relaxed text-foreground/80">{b.a}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section aria-labelledby="pricing-cta-title" className="bg-night text-cream">
        <div className={cn(container, "flex flex-col gap-6 py-14 sm:flex-row sm:items-center sm:justify-between")}>
          <h2 id="pricing-cta-title" className="max-w-lg text-2xl leading-snug sm:text-3xl">
            Try it on the demo leads first.
          </h2>
          <CtaLink href={links.signUp} tone="cream">
            Start free
          </CtaLink>
        </div>
      </section>
    </>
  );
}
