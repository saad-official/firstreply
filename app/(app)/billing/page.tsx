import type { Metadata } from "next";
import Link from "next/link";
import { CircleCheck, FlaskConical, Info } from "lucide-react";
import { ManageButton, UpgradeButton } from "@/components/billing/billing-buttons";
import { PageHeader } from "@/components/app/page-header";
import { Pill } from "@/components/app/pills";
import { Progress } from "@/components/ui/progress";
import { requireOrgContext } from "@/lib/auth/session";
import { listForOrg as listForms } from "@/lib/db/repositories/forms";
import { countBillableCreatedSince } from "@/lib/db/repositories/leads";
import { listForOrg as listWebhookTokens } from "@/lib/db/repositories/webhookTokens";
import type { Plan } from "@/lib/db/types";
import { formatDate } from "@/lib/format";
import {
  FREE_LEADS_PER_MONTH,
  limitsFor,
  monthStartUtc,
  nextMonthStartUtc,
  PLAN_LIMITS,
  PRO_PRICE_USD,
} from "@/lib/services/plan-limits";
import { isBillingConfigured, isPortalConfigured } from "@/lib/stripe/billing";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Billing" };

const PLANS: { id: Plan; name: string; price: string; blurb: string; features: string[] }[] = [
  {
    id: "free",
    name: "Free",
    price: "$0",
    blurb: "Every reply is checked by you before it goes out.",
    features: [
      `${FREE_LEADS_PER_MONTH} leads a month`,
      `${PLAN_LIMITS.free.forms} active hosted form`,
      `${PLAN_LIMITS.free.webhookTokens} active webhook endpoint`,
      "Manual approval of every reply",
      "Booking page",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    price: `$${PRO_PRICE_USD}`,
    blurb: "For when you trust it with your best-fit leads.",
    features: [
      "Unlimited leads",
      "Unlimited hosted forms and webhook endpoints",
      "Auto-reply for high-fit leads (score ≥ 70, confidence ≥ 0.8)",
      "Everything in Free",
    ],
  },
];

function requestTime(): Date {
  return new Date();
}

function UsageBar({ label, used, limit }: { label: string; used: number; limit: number }) {
  const pct = Math.min(100, Math.round((used / limit) * 100));
  const tone =
    used >= limit
      ? "*:data-[slot=progress-indicator]:bg-coral-ink"
      : pct >= 80
        ? "*:data-[slot=progress-indicator]:bg-lemon"
        : "*:data-[slot=progress-indicator]:bg-sea";
  return <Progress value={pct} aria-label={label} className={cn("h-1.5 bg-foreground/10", tone)} />;
}

function Usage({ label, used, limit, unit }: { label: string; used: number; limit: number | null; unit: string }) {
  const full = limit !== null && used >= limit;
  return (
    <div className="grid gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-sm whitespace-nowrap text-muted-foreground">
          <span className={cn("stopwatch text-base text-foreground", full && "text-coral-ink")}>{used}</span>
          {limit === null ? " · no limit" : ` of ${limit}`}
        </p>
      </div>
      {limit !== null ? <UsageBar label={`${label}: ${used} of ${limit} ${unit}`} used={used} limit={limit} /> : null}
    </div>
  );
}

export default async function BillingPage({ searchParams }: PageProps<"/billing">) {
  const { org, role } = await requireOrgContext();
  const { checkout } = await searchParams;
  const now = requestTime();

  const [leadsUsed, forms, tokens] = await Promise.all([
    countBillableCreatedSince(org.id, monthStartUtc(now)),
    listForms(org.id),
    listWebhookTokens(org.id),
  ]);
  const activeForms = forms.filter((f) => f.active).length;
  const activeTokens = tokens.filter((t) => !t.revokedAt).length;

  const limits = limitsFor(org.plan);
  const isPro = org.plan === "pro";
  const isOwner = role === "owner";
  const configured = isBillingConfigured();
  const portalAvailable = Boolean(isPortalConfigured() && org.stripeCustomerId);
  const resetLabel = formatDate(nextMonthStartUtc(now), "UTC");
  const leadsLeft = limits.leadsPerMonth === null ? null : Math.max(0, limits.leadsPerMonth - leadsUsed);

  return (
    <>
      <PageHeader
        title="Billing"
        description="Your plan, this month's usage and payments through Stripe."
        actions={<Pill tone={isPro ? "night" : "outline"}>{isPro ? "Pro plan" : "Free plan"}</Pill>}
      />

      <div className="grid gap-8">
        {checkout === "success" ? (
          <p role="status" className="flex items-start gap-2.5 rounded-xl bg-sea/12 px-4 py-3 text-sm ring-1 ring-sea/30">
            <CircleCheck className="mt-0.5 size-4 shrink-0 text-sea" aria-hidden />
            {isPro
              ? "Payment received. You're on Pro."
              : "Payment received; your plan updates when Stripe confirms, usually within a few seconds. Refresh the page to check."}
          </p>
        ) : checkout === "cancelled" ? (
          <p role="status" className="flex items-start gap-2.5 rounded-xl bg-muted px-4 py-3 text-sm text-foreground/85">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
            Checkout cancelled. Nothing was charged and your plan is unchanged.
          </p>
        ) : null}

        <aside
          aria-label="Test mode"
          className="flex items-start gap-3 rounded-xl border border-dashed border-lemon-foreground/40 bg-lemon/25 px-4 py-3 text-sm text-lemon-foreground dark:text-lemon"
        >
          <FlaskConical className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>
            <span className="font-semibold">Test mode.</span> Stripe runs in its sandbox here, so no real payments are
            taken. Pay with card <span className="stopwatch whitespace-nowrap">4242 4242 4242 4242</span>, any future
            expiry date and any CVC.
          </p>
        </aside>

        <section aria-labelledby="usage-heading" className="grid gap-4">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <h2 id="usage-heading" className="font-heading text-xl">
              This month
            </h2>
            <p className="text-sm text-muted-foreground">
              Resets <span className="stopwatch text-foreground">{resetLabel}</span> (UTC)
            </p>
          </div>
          <div className="grid gap-6 rounded-2xl bg-card p-5 shadow-card ring-1 ring-foreground/10 sm:p-6 md:grid-cols-[1.3fr_1fr] md:gap-10">
            <div className="grid content-start gap-3">
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Leads received</p>
              <p className="flex items-baseline gap-2">
                <span className="stopwatch text-5xl leading-none">{leadsUsed}</span>
                <span className="text-sm text-muted-foreground">
                  {limits.leadsPerMonth === null ? "no limit on Pro" : `of ${limits.leadsPerMonth} on Free`}
                </span>
              </p>
              {limits.leadsPerMonth !== null ? (
                <UsageBar
                  label={`Leads this month: ${leadsUsed} of ${limits.leadsPerMonth}`}
                  used={leadsUsed}
                  limit={limits.leadsPerMonth}
                />
              ) : null}
              <p className="text-xs leading-relaxed text-muted-foreground">
                {leadsLeft === null
                  ? "Every real lead counts here for your records."
                  : leadsLeft === 0
                    ? "You've used this month's leads. New enquiries are refused until the reset, or upgrade to keep them coming."
                    : `${leadsLeft} left this month.`}{" "}
                Demo leads and leads marked as spam don&apos;t count.
              </p>
            </div>
            <div className="grid content-start gap-5 border-t pt-5 md:border-t-0 md:border-l md:pt-0 md:pl-10">
              <Usage label="Active hosted forms" used={activeForms} limit={limits.forms} unit="forms" />
              <Usage label="Active webhook endpoints" used={activeTokens} limit={limits.webhookTokens} unit="endpoints" />
              <p className="text-xs text-muted-foreground">
                Manage them in{" "}
                <Link href="/settings#forms" className="font-medium text-foreground underline underline-offset-3">
                  Settings
                </Link>
                .
              </p>
            </div>
          </div>
        </section>

        <section aria-labelledby="plans-heading" className="grid gap-4">
          <h2 id="plans-heading" className="font-heading text-xl">
            Plans
          </h2>
          <ul className="grid gap-5 md:grid-cols-2">
            {PLANS.map((plan) => {
              const current = plan.id === org.plan;
              const dark = plan.id === "pro";
              return (
                <li
                  key={plan.id}
                  aria-current={current ? "true" : undefined}
                  className={cn(
                    "flex flex-col rounded-3xl p-6 sm:p-8",
                    dark ? "bg-foreground text-background" : "bg-card shadow-card ring-1 ring-foreground/10",
                    current && !dark && "ring-2 ring-coral-ink",
                  )}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h3 className="text-2xl">{plan.name}</h3>
                    {current ? (
                      <Pill tone={dark ? "lemon" : "coral"}>Current plan</Pill>
                    ) : dark ? (
                      <Pill tone="lemon">Auto-reply</Pill>
                    ) : null}
                  </div>
                  <p className="mt-5 flex items-baseline gap-2">
                    <span className="stopwatch text-5xl leading-none">{plan.price}</span>
                    <span className={cn("text-sm", dark ? "text-background/80" : "text-foreground/75")}>a month</span>
                  </p>
                  <p className={cn("mt-4 text-[0.9375rem] leading-relaxed", dark ? "text-background/85" : "text-foreground/80")}>
                    {plan.blurb}
                  </p>
                  <ul className="mt-6 flex-1 space-y-2.5 text-[0.9375rem]">
                    {plan.features.map((f) => (
                      <li key={f} className="flex gap-3">
                        <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-coral" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>

                  {dark ? (
                    <div className="mt-8 grid gap-3">
                      {isPro ? (
                        portalAvailable ? (
                          <ManageButton disabled={!isOwner} onDark />
                        ) : (
                          <p className="text-sm text-background/80">
                            Subscription management opens once Stripe has linked a customer to this workspace.
                          </p>
                        )
                      ) : (
                        <>
                          <UpgradeButton disabled={!configured || !isOwner} describedBy="upgrade-note" />
                          <p id="upgrade-note" className="text-xs leading-relaxed text-background/75">
                            {!configured
                              ? "Billing isn't set up on this deployment yet (Stripe keys are missing), so upgrading is turned off."
                              : !isOwner
                                ? "Only the workspace owner can change the plan."
                                : `Opens Stripe Checkout for $${PRO_PRICE_USD} a month. Cancel any time from Manage subscription.`}
                          </p>
                          {portalAvailable ? <ManageButton disabled={!isOwner} onDark /> : null}
                        </>
                      )}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Cancelling, or a renewal that fails for good, moves the workspace back to Free. Leads, replies and meetings
            are kept; auto-reply stops and every reply waits for your approval again.
          </p>
        </section>
      </div>
    </>
  );
}
