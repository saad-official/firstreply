# Firstreply — implementation plan

Reuses the Drizzle + Better Auth plumbing from Attestly/Conformly (no pgvector).

## Phase 0 — Foundation
- [x] Scaffold, identity (Bricolage Grotesque + Inter + JetBrains Mono; coral / sea / lemon), spec, README
- [x] Neon project, Vercel project (getfirstreply.vercel.app), Stripe product ($39/month), base env vars

## Phase 1 — Data layer
- [ ] Schema in Postgres schema `firstreply`: availability rules, blackouts, forms, webhook tokens, leads, messages, slot offers, meetings, outbox, append-only agent_events
- [ ] Repositories, Better Auth, PGlite for local dev and tests

## Phase 2 — Core (pure)
- [ ] Availability and slot suggestion (timezones, DST, buffers, notice, horizon, spread)
- [ ] Scoring adjustments, reply guardrails, negotiation state machine, webhook adapters, ICS, dedupe

## Phase 3 — Services and screens
- [ ] Lead intake (hosted form, webhook, demo inbox), enrichment via the series crawler, scoring and drafting, approval queue, booking page, negotiation, pipeline board, dashboard, settings (rubric, offer, availability, autonomy), billing
- [ ] API: webhook intake, booking, cron daily, Stripe webhook

## Phase 4 — Ship
- [ ] Marketing site, deploy, env script, end-to-end verification with demo leads
