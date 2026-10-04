import type { Metadata } from "next";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { CtaLink } from "@/components/marketing/cta-link";
import { Faq } from "@/components/marketing/faq";
import { AutonomyMock } from "@/components/marketing/mocks/autonomy-mock";
import { DashboardMock } from "@/components/marketing/mocks/dashboard-mock";
import { HeroMock } from "@/components/marketing/mocks/hero-mock";
import { BookMock, CaptureMock, ScoreMock, SlotsMock } from "@/components/marketing/mocks/step-mocks";
import { PricingPlans } from "@/components/marketing/pricing-plans";
import { SectionLabel } from "@/components/marketing/section-label";
import { container, links, textLink } from "@/components/marketing/site";
import { Dot } from "@/components/marketing/wordmark";

export const metadata: Metadata = {
  title: { absolute: "Firstreply · Answer every lead in under a minute" },
  description:
    "Your form or inbox hands each lead to Firstreply. It scores the lead against your rubric, replies within a minute with a personal note and three real slots, and books the meeting when they pick one. Inbound only; you approve every reply until you decide to trust it.",
  alternates: { canonical: "/" },
};

const figures = [
  {
    figure: "47",
    unit: "h",
    text: "about 47 hours average first response to an inbound lead",
    source: "RevenueHero, 2026",
  },
  {
    figure: "4.7",
    unit: "%",
    text: "only 4.7% reply within five minutes",
    source: "RevenueHero, 2026",
  },
  {
    figure: "21",
    unit: "×",
    text: "a 5-minute reply is 21× more likely to qualify than a 30-minute one",
    source: "prospeo, citing the MIT/InsideSales lead response study",
  },
];

const steps = [
  {
    id: "capture",
    lap: "00:00",
    title: "Capture",
    body: (
      <>
        Point your website form at a webhook, use the hosted form, or forward your enquiries inbox. Typeform, Tally,
        Webflow and Framer posts are mapped for you. The clock starts the moment the lead lands.
      </>
    ),
    visual: <CaptureMock />,
  },
  {
    id: "score",
    lap: "00:09",
    title: "Score",
    body: (
      <>
        Firstreply reads the lead&rsquo;s public website, then scores the lead from 0 to 100 against a rubric you write
        in plain English. You see the score and each reason, so you can tell why a lead is high or low fit. Spam is
        archived; low fit gets a kind decline for you to approve.
      </>
    ),
    visual: <ScoreMock />,
  },
  {
    id: "reply",
    lap: "00:48",
    title: "Reply with real slots",
    body: (
      <>
        The reply is short and addressed to the person, and it offers three times that are actually free: across
        different days, inside your hours, with your buffer and minimum notice. Your booking link goes in too, for
        anyone who would rather pick.
      </>
    ),
    visual: <SlotsMock />,
  },
  {
    id: "book",
    lap: "later",
    title: "Negotiate and book",
    body: (
      <>
        When they answer, Firstreply reads it. A picked slot is booked. &ldquo;Thursday afternoon?&rdquo; is checked
        against your availability and booked if free, or answered with two nearby times. A question gets a drafted
        answer. The confirmation carries an .ics invite.
      </>
    ),
    visual: <BookMock />,
  },
];

const trust = [
  {
    title: "Inbound only",
    body: "It answers people who contacted you. It cannot import a list, start a conversation, or send cold outreach of any kind.",
  },
  {
    title: "Reads only the lead’s public website",
    body: "Enrichment fetches the homepage of the lead’s email domain, respects robots.txt, and skips free-mail domains. No data brokers, no social profiles.",
  },
  {
    title: "Every model call is logged",
    body: "Each score and draft records the model, prompt version, tokens and time taken, next to the lead it was for.",
  },
  {
    title: "Synthetic demo data",
    body: "The demo loads twelve invented leads from fictional companies, and outgoing email lands in an in-app outbox. Please keep real customer details out of it.",
  },
];

function SectionHeading({
  id,
  label,
  lap,
  title,
  intro,
  onDark = false,
}: {
  id: string;
  label: string;
  lap?: string;
  title: React.ReactNode;
  intro?: React.ReactNode;
  onDark?: boolean;
}) {
  return (
    <div className="max-w-3xl">
      <SectionLabel lap={lap} onDark={onDark}>
        {label}
      </SectionLabel>
      <h2 id={`${id}-title`} className="mt-4 text-3xl leading-tight text-balance sm:text-4xl lg:text-5xl">
        {title}
      </h2>
      {intro ? (
        <p
          className={cn(
            "mt-5 max-w-2xl text-lg leading-relaxed text-pretty",
            onDark ? "text-cream/85" : "text-foreground/80",
          )}
        >
          {intro}
        </p>
      ) : null}
    </div>
  );
}

export default function HomePage() {
  return (
    <>
      {/* a. Hero */}
      <section aria-labelledby="hero-title" className="dotgrid border-b border-border">
        <div className={cn(container, "pt-14 pb-16 sm:pt-20 lg:pb-24")}>
          <div className="grid gap-8 lg:grid-cols-12 lg:items-end">
            <div className="lg:col-span-7">
              <p className="pill bg-card text-foreground/80 ring-1 ring-foreground/10">
                <Dot />
                Speed-to-lead for small service businesses
              </p>
              <h1
                id="hero-title"
                className="mt-6 text-[2.75rem] leading-[1.02] font-extrabold text-balance sm:text-6xl lg:text-7xl"
              >
                Answer every lead in under a minute.
              </h1>
            </div>
            <div className="lg:col-span-5 lg:pb-2">
              <p className="text-lg leading-relaxed text-pretty text-foreground/85">
                Your form or inbox hands the lead to Firstreply. It scores the lead against your rubric, replies with a
                personal note and three real slots, and books the meeting when they pick one. You approve every reply
                until you decide to trust it.
              </p>
              <div className="mt-7 flex flex-wrap gap-3">
                <CtaLink href={links.signUp}>Start free</CtaLink>
                <CtaLink href="#how-it-works" tone="outline">
                  See how it works
                </CtaLink>
              </div>
            </div>
          </div>
          <HeroMock className="mt-14 lg:mt-16" />
        </div>
      </section>

      {/* b. Problem strip */}
      <section aria-labelledby="problem-title" className="bg-night text-cream">
        <div className={cn(container, "py-14 sm:py-16")}>
          <h2 id="problem-title" className="max-w-2xl text-2xl leading-snug text-balance sm:text-3xl">
            Most enquiries wait days for a first answer. The fast replies win.
          </h2>
          <ul className="mt-10 grid gap-8 md:grid-cols-3 md:gap-6">
            {figures.map((f) => (
              <li key={f.figure} className="border-t border-cream/20 pt-5">
                <p className="stopwatch flex items-baseline text-5xl leading-none text-coral sm:text-6xl" aria-hidden="true">
                  {f.figure}
                  <span className="ml-1 text-3xl sm:text-4xl">{f.unit}</span>
                </p>
                <p className="mt-4 text-[0.9375rem] leading-relaxed">{f.text}</p>
                <p className="mt-2 text-xs leading-relaxed text-cream/75">
                  Source: {f.source}. Vendor-published figure.
                </p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* c. How it works */}
      <section id="how-it-works" aria-labelledby="how-it-works-title" className="scroll-mt-4">
        <div className={cn(container, "py-20 sm:py-24")}>
          <SectionHeading
            id="how-it-works"
            label="How it works"
            title="From form to booked meeting, with you in the loop."
            intro="Four steps, timed on the example lead from the top of the page. The first three take under a minute; the fourth waits on the person you're talking to."
          />
          <ol className="mt-14 space-y-16 sm:space-y-20">
            {steps.map((s, i) => (
              <li key={s.id} className="grid gap-8 lg:grid-cols-12 lg:gap-10">
                <div className="lg:col-span-4">
                  <p className="flex items-center gap-3">
                    <span className="stopwatch grid size-9 place-items-center rounded-full bg-foreground text-sm text-background">
                      {i + 1}
                    </span>
                    <span className="stopwatch rounded-full bg-foreground/[0.06] px-2.5 py-1 text-xs text-foreground/80">
                      <span className="sr-only">Elapsed: </span>
                      {s.lap}
                    </span>
                  </p>
                  <h3 className="mt-4 text-2xl sm:text-3xl">{s.title}</h3>
                  <p className="mt-3 text-[0.9375rem] leading-relaxed text-foreground/80">{s.body}</p>
                </div>
                <div className="min-w-0 rounded-3xl bg-secondary p-4 sm:p-6 lg:col-span-8">{s.visual}</div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* d. Autonomy */}
      <section aria-labelledby="autonomy-title" className="border-y border-border bg-card">
        <div className={cn(container, "grid gap-12 py-20 sm:py-24 lg:grid-cols-12 lg:gap-10")}>
          <div className="lg:col-span-6">
            <SectionHeading
              id="autonomy"
              label="Approval"
              title="You approve every reply until you say otherwise."
            />
            <div className="mt-6 max-w-xl space-y-4 text-[0.9375rem] leading-relaxed text-foreground/85">
              <p>
                Every draft lands in an approval queue with the lead, the score reasons and the slots it offers. Send
                it as written, edit it, or reject it. On the Free plan that is how every reply goes out.
              </p>
              <p>
                On Pro you can turn on auto-reply for the leads you would never turn away: a score of 70 or more and a
                draft confidence of 0.8 or more. Everything else still waits for you.
              </p>
              <p>
                Two kinds of message always wait, whatever the setting: declines, and anything that mentions pricing.
                Those deserve your judgement, not a threshold.
              </p>
            </div>
          </div>
          <div className="min-w-0 lg:col-span-6">
            <AutonomyMock />
          </div>
        </div>
      </section>

      {/* e. Outcomes */}
      <section aria-labelledby="outcomes-title">
        <div className={cn(container, "py-20 sm:py-24")}>
          <SectionHeading
            id="outcomes"
            label="Reporting"
            title="Measured in minutes and meetings."
            intro="The dashboard reports how fast each lead heard back, how many qualified, and how many meetings were booked and held, not opens and clicks."
          />
          <DashboardMock className="mt-10" />
        </div>
      </section>

      {/* f. Trust */}
      <section aria-labelledby="trust-title" className="dotgrid border-y border-border">
        <div className={cn(container, "grid gap-10 py-20 sm:py-24 lg:grid-cols-12")}>
          <div className="lg:col-span-4">
            <SectionHeading id="trust" label="Boundaries" title="What it will and won’t do." />
          </div>
          <dl className="grid gap-x-8 gap-y-8 sm:grid-cols-2 lg:col-span-8">
            {trust.map((t) => (
              <div key={t.title} className="rounded-2xl bg-card p-5 ring-1 ring-foreground/10">
                <dt className="font-heading text-lg leading-snug font-bold">{t.title}</dt>
                <dd className="mt-2 text-[0.9375rem] leading-relaxed text-foreground/80">{t.body}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* g. Pricing */}
      <section id="pricing" aria-labelledby="pricing-title" className="scroll-mt-4">
        <div className={cn(container, "py-20 sm:py-24")}>
          <SectionHeading
            id="pricing"
            label="Pricing"
            title="Free for 25 leads a month. $39 when you want it to answer on its own."
          />
          <div className="mt-10">
            <PricingPlans />
          </div>
          <p className="mt-6 text-sm">
            <Link href={links.pricing} className={textLink}>
              Compare plans in detail
            </Link>
          </p>
        </div>
      </section>

      {/* h. FAQ */}
      <section aria-labelledby="faq-title" className="border-t border-border">
        <div className={cn(container, "grid gap-10 py-20 sm:py-24 lg:grid-cols-12")}>
          <div className="lg:col-span-4">
            <SectionHeading id="faq" label="Questions" title="Things people ask first." />
          </div>
          <div className="lg:col-span-8">
            <Faq />
          </div>
        </div>
      </section>

      {/* i. Final CTA */}
      <section aria-labelledby="cta-title" className="bg-night text-cream">
        <div className={cn(container, "flex flex-col gap-8 py-16 sm:py-20 lg:flex-row lg:items-end lg:justify-between")}>
          <div>
            <p className="stopwatch text-6xl leading-none text-coral sm:text-7xl" aria-hidden="true">
              00:48
            </p>
            <h2 id="cta-title" className="mt-6 max-w-xl text-3xl leading-tight text-balance sm:text-4xl">
              Your next enquiry could hear back before they close the tab.
            </h2>
            <p className="mt-4 max-w-xl text-[0.9375rem] leading-relaxed text-cream/85">
              Free for 25 leads a month. Load the demo leads and watch the first reply draft itself.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <CtaLink href={links.signUp} tone="cream">
              Start free
            </CtaLink>
            <CtaLink href={links.repo} tone="cream-outline">
              Read the source
            </CtaLink>
          </div>
        </div>
      </section>
    </>
  );
}
