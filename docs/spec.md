# Firstreply — product and technical spec

Status: approved design, 2026-10-04. App 5 of the [Vibe Build Series](https://github.com/saad-official/vibe-build-series).

## 1. Problem

Small businesses average about 47 hours to respond to an inbound lead; 63.5% never respond and only 4.7% reply within five minutes, while a five-minute reply is 21× more likely to qualify than a thirty-minute one (RevenueHero 2026, prospeo). Enterprise speed-to-lead tools (Chili Piper, Default, Qualified) assume Salesforce and per-seat pricing. Agencies, clinics, law firms and B2B services run on a web form, a shared inbox and a calendar.

Firstreply receives the lead (form webhook, hosted form, or forwarded email), researches and scores it against a plain-English ideal-customer rubric, replies within a minute with a personalised message and three real slots from the owner's availability, negotiates "none of those work" by email, books the meeting, and reports median response time, qualified rate and meetings booked.

Inbound only: it never cold-emails anyone.

## 2. Users and plans

- Owner / sales lead at a 1–20 person services business.
- Free: 25 leads a month, one inbox, manual approval of every reply, hosted lead form, booking page.
- Pro ($39/month): unlimited leads, auto-reply for high-score leads above a confidence threshold, Google Calendar sync (later), weekly report email, Slack/webhook notifications.

## 3. Core flows

### 3.1 Capture
- Hosted form at `/f/<slug>` (name, email, company, message, custom fields), embeddable `<script>` snippet, and `POST /api/leads/webhook/<token>` accepting JSON or form bodies (Typeform/Tally/Webflow/Framer shapes mapped by a small adapter table).
- Email forwarding to a per-org alias (demo mode: paste the email into the Demo Inbox).
- Dedupe by email within 30 days; the second message appends to the existing lead's thread.

### 3.2 Enrich and score (agent, fast path)
1. Parse the email domain; skip free-mail domains for company lookup.
2. Fetch the company homepage with the series crawler (no JS, 8 s, robots.txt), extract title, description, headings, text excerpt (reuse Conformly's `extractDocument`).
3. Score against the org's **ICP rubric**: free-text criteria the owner writes ("B2B SaaS 10–200 people in UK/EU; budget signals; not agencies") → the model returns `{ score 0–100, fit: 'high' | 'medium' | 'low' | 'spam', reasons[], summary }` with Zod. Deterministic adjustments: free-mail domain −10, message under 10 words −10, form honeypot filled → spam.
4. Decision: spam → archive; low → polite decline draft (approval); medium/high → reply draft with slots; Pro + autonomy on + score ≥ 70 + confidence ≥ 0.8 → auto-send.
5. Target: webhook received → draft stored in under 60 s (Groq, one call).

### 3.3 Availability and slots (deterministic)
- Org availability rules: weekdays and hours per day in the org timezone, meeting length (15/30/45), buffer, minimum notice (default 4 h), horizon (default 10 business days), blackout dates.
- Busy times come from existing bookings and, later, Google Calendar free/busy.
- `suggestSlots(rules, busy, now, n = 3)` picks three slots spread across different days (morning/afternoon mix) and renders them in the lead's probable timezone (from the form or the email headers) and the owner's.
- Booking page `/b/<slug>` lists free slots for the next horizon; a booking creates a `meetings` row, an ICS attachment in the confirmation email, and blocks the slot.

### 3.4 Reply drafting (agent)
Prompt inputs: lead message, enrichment summary, score reasons, org voice, offer description ("20-minute intro call"), three slots with a booking link. Output `{ subject, body, confidence, rationale }`. Guardrails: must include all three slots verbatim and the booking link, must address the person by first name if known, no pricing promises, no claims about the company beyond the enrichment summary, length 60–180 words, sign-off present. Decline drafts: kind, short, one alternative (resource link).

### 3.5 Negotiation (reply reading)
Inbound replies (demo inbox / inbound webhook) are classified: `accepts_slot (which)`, `proposes_time (parsed datetime)`, `asks_question`, `not_interested`, `out_of_office`, `other`. Deterministic handling: accept → book; propose → check availability, book or counter with two alternatives (draft); question → draft answer for approval; not interested → close lead with reason; OOO → follow up after return date.

### 3.6 Pipeline and reports
Leads board: new / replied / negotiating / booked / declined / spam, with timestamps. Lead detail: thread, enrichment, score reasons, actions. Dashboard tiles: median first-response time (agent vs. the 47-hour benchmark), reply rate, qualified rate, meetings booked, no-show rate (owner marks), leads by source. Weekly report email (Pro) via the Outbox provider.

### 3.7 Demo
"Load demo leads" posts 12 synthetic leads through the real webhook path (fictional companies with fixture homepages served from an internal route so enrichment works offline), spanning high/medium/low/spam, and seeds availability rules. "Simulate reply" writes a plausible lead reply with an intent of choice.

## 4. Data model (schema `firstreply`)

```
organizations, memberships, auth tables, orgs settings: timezone, voice jsonb, rubric text, offer text, autonomy
availability_rules(id, org_id, weekday, start_minute, end_minute), blackouts(id, org_id, date)
forms(id, org_id, slug, fields jsonb, honeypot_field), webhook_tokens(id, org_id, token, source_label)
leads(id, org_id, source, name, email, company, domain, message, custom jsonb, lead_timezone, status, score,
      fit, score_reasons jsonb, enrichment jsonb, first_reply_at, created_at)
messages(id, org_id, lead_id, direction: in|out, kind: reply|decline|counter|question_answer|confirmation,
         subject, body, status: draft|approved|sent|rejected, confidence, rationale, classification jsonb,
         simulated, sent_at, created_at)
slot_offers(id, message_id, starts_at, ends_at)
meetings(id, org_id, lead_id, starts_at, ends_at, status: booked|cancelled|no_show|held, ics_uid)
outbox, agent_events
```

## 5. Identity

Fast and friendly, not corporate. Type: **Bricolage Grotesque** (headings) + **Inter** (body) + **JetBrains Mono** (timestamps). Palette: night `#13161C`, cream `#FBF7EE`, **coral** `#E4573D` (primary, "reply now"), sea `#1F7A8C` (booked), lemon `#F2C94C` (needs approval), grey `#6B7280`. The hero shows a stopwatch-style first-response timer next to a lead card and its drafted reply.

## 6. Tests

suggestSlots (timezones, DST, buffers, notice, horizon, spread), rubric adjustments, reply guardrails (slots and link present), negotiation state machine, webhook adapters, ICS generation, dedupe window.
