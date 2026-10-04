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
