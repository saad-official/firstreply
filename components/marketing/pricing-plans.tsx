import { cn } from "@/lib/utils";
import { CtaLink } from "./cta-link";
import { links } from "./site";

const plans = [
  {
    name: "Free",
    price: "$0",
    period: "a month",
    blurb: "For trying it on real enquiries, with every reply checked by you.",
    features: [
      "25 leads a month",
      "One inbox",
      "Manual approval of every reply",
      "Hosted lead form and embed snippet",
      "Booking page",
    ],
    cta: "Start free",
    featured: false,
  },
  {
    name: "Pro",
    price: "$39",
    period: "a month",
    blurb: "For when you trust it with your best-fit leads.",
    features: [
      "Unlimited leads",
      "Auto-reply for high-fit leads (score ≥ 70, confidence ≥ 0.8)",
      "Weekly report email",
      "Slack and webhook notifications",
      "Everything in Free",
    ],
    cta: "Start free, upgrade later",
    featured: true,
  },
];

export function PricingPlans({ headingLevel = "h3" }: { headingLevel?: "h2" | "h3" }) {
  const Heading = headingLevel;
  return (
    <div>
      <ul className="grid gap-5 md:grid-cols-2">
        {plans.map((p) => (
          <li
            key={p.name}
            className={cn(
              "flex flex-col rounded-3xl p-6 sm:p-8",
              p.featured ? "bg-foreground text-background" : "bg-card shadow-card ring-1 ring-foreground/10",
            )}
          >
            <div className="flex items-center justify-between gap-3">
              <Heading className="text-2xl">{p.name}</Heading>
              {p.featured ? <span className="pill bg-lemon text-lemon-foreground">Auto-reply</span> : null}
            </div>
            <p className="mt-5 flex items-baseline gap-2">
              <span className="stopwatch text-5xl leading-none">{p.price}</span>
              <span className={cn("text-sm", p.featured ? "text-background/80" : "text-foreground/75")}>
                {p.period}
              </span>
            </p>
            <p
              className={cn(
                "mt-4 text-[0.9375rem] leading-relaxed",
                p.featured ? "text-background/85" : "text-foreground/80",
              )}
            >
              {p.blurb}
            </p>
            <ul className="mt-6 flex-1 space-y-2.5 text-[0.9375rem]">
              {p.features.map((f) => (
                <li key={f} className="flex gap-3">
                  <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-coral" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <CtaLink
              href={links.signUp}
              tone={p.featured ? "cream" : "outline"}
              className="mt-8 w-full whitespace-normal text-center"
            >
              {p.cta}
            </CtaLink>
          </li>
        ))}
      </ul>
      <p className="mt-5 max-w-2xl text-sm leading-relaxed text-foreground/75">
        Stripe runs in test mode on this demo, so no real payments are taken. Google Calendar sync is planned for Pro
        and not built yet.
      </p>
    </div>
  );
}
