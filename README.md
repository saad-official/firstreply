# Firstreply

**Answer every lead in under a minute.** Firstreply receives inbound leads from your form, webhook or inbox, scores each one against a rubric you write in plain English, replies within a minute with a personal message and three real slots from your availability, negotiates the time by email, and books the meeting. Inbound only: it never cold-emails anyone. Every reply waits for your approval until you decide to trust it.

Part of the [Vibe Build Series](https://github.com/saad-official/vibe-build-series): real products for small businesses, built in public on free tiers.

## Why

Small businesses take about 47 hours on average to answer an inbound lead; only 4.7% reply within five minutes, and a five-minute reply is far more likely to qualify than a thirty-minute one (RevenueHero, 2026). Enterprise speed-to-lead tools assume Salesforce and per-seat pricing. Agencies, clinics, law firms and B2B services run on a web form, a shared inbox and a calendar.

## Stack

Next.js 16 · React 19 · TypeScript · Tailwind 4 · shadcn/ui · Neon Postgres · Drizzle ORM · Better Auth · Vercel AI SDK 7 with Groq and Gemini · Stripe (test mode) · Vitest · Vercel

## Run it locally

```bash
pnpm install
cp .env.example .env.local   # leave DATABASE_URL empty to use embedded PGlite
pnpm dev
```

## Docs

- [Spec](docs/spec.md)

## Live demo

https://getfirstreply.vercel.app · Stripe runs in test mode (card `4242 4242 4242 4242`).

1. Sign up (no card). On the empty dashboard, click **Load demo workspace**: six fictional leads for the agency "Northwind Studio" run through the real pipeline (enrichment from offline `.example` homepages, Groq scoring with signed reasons, a drafted reply with three real slots from the default Mon–Fri 09:00–17:00 availability).
2. The **Queue** shows every draft with *why it waits* (a decline, a pricing question, Free plan) and which would auto-send on Pro. Approve, edit or reject.
3. Open the lead and **Simulate lead reply** with accept / counter / question / decline / out-of-office. An accept books the meeting, sends the confirmation with an `.ics` invite, and the lead moves to Booked.
4. The public booking page `/b/<your-slug>` and hosted form `/f/<your-slug>` work without sign-in; webhooks accept Typeform, Tally, Webflow and Framer payloads at `/api/leads/webhook/<token>`.
5. Dashboard: median first reply against the 47-hour small-business average, replies under 60 s, meetings booked, agent activity log.

Verified end to end on 4 Oct 2026 against the production Neon database: demo leads scored and drafted by Groq, a draft approved and sent, a simulated accept booked a meeting with a valid `text/calendar` invite; cron and Stripe webhook routes answer correctly.

## Known gaps

- Email leaves through the in-app Outbox (or Resend demo mode to your own address); no inbound mailbox is connected, so real lead replies arrive through `/api/inbound/email`.
- Rate limiting is per server instance; the monthly lead cap in the database is the hard limit.
- The provider set-up guides on the settings page were written from documentation memory and should be checked against each provider.
