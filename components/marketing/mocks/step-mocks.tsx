import { cn } from "@/lib/utils";
import { heroSlots } from "./hero-mock";
import { Becomes, FauxField, MockCard, Pill, SlotLine } from "./parts";

/** Step 1: three ways in. Hosted form and snippet, webhook URL, forwarded email. */
export function CaptureMock() {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <MockCard label="Hosted form · /f/fernway" className="sm:row-span-2">
        <div className="space-y-2.5">
          <FauxField label="Name">Priya Raman</FauxField>
          <FauxField label="Work email">priya@lumenclinics.example</FauxField>
          <FauxField label="Company">Lumen Clinics</FauxField>
          <FauxField label="What do you need?">Two new sites, patient intake&hellip;</FauxField>
        </div>
        <p className="mt-4 text-[0.6875rem] font-semibold text-foreground/70">Or embed it on your site</p>
        <pre className="mt-1 rounded-lg whitespace-pre-wrap break-all bg-foreground px-3 py-2.5 font-mono text-[0.6875rem] leading-relaxed text-background">
          <code>{`<script src="/embed.js"\n  data-form="fernway" async>\n</script>`}</code>
        </pre>
      </MockCard>
      <MockCard label="Webhook">
        <p className="font-mono text-xs leading-relaxed break-all">
          <span className="font-semibold text-(--coral-ink)">POST</span> /api/leads/webhook/whk_7f3a&hellip;
        </p>
        <p className="mt-3 text-xs text-foreground/75">Accepts JSON or form bodies from</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {["Typeform", "Tally", "Webflow", "Framer"].map((s) => (
            <Pill key={s} tone="quiet">
              {s}
            </Pill>
          ))}
        </div>
      </MockCard>
      <MockCard label="Email">
        <p className="text-sm leading-relaxed">
          Forward enquiries to <span className="font-mono text-xs font-medium break-all">leads@&hellip;</span>, your own
          inbound alias.
        </p>
        <p className="mt-2 text-xs text-foreground/75">A second message from the same address within 30 days joins the same thread.</p>
      </MockCard>
    </div>
  );
}

const reasons = [
  { sign: "+", text: "Clinic group, about 60 staff, per lumenclinics.example" },
  { sign: "+", text: "Budget mentioned: “approved for Q4”" },
  { sign: "+", text: "UK based, sites in Leeds and York" },
  { sign: "−", text: "No timeline given beyond Q4" },
];

/** Step 2: the owner's rubric in plain English, and the score it produced. */
export function ScoreMock() {
  return (
    <div className="grid items-center gap-3 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
      <MockCard label="Your rubric">
        <p className="rounded-lg border border-input bg-background px-3 py-2.5 text-sm leading-relaxed">
          B2B SaaS or clinics with 10–200 staff in UK/EU; budget mentioned; not agencies
        </p>
        <p className="mt-2 text-xs text-foreground/75">Written once, in your words. Edit it any time.</p>
      </MockCard>
      <Becomes turn label="00:09" />
      <MockCard label="Score · Priya Raman" meta="conf 0.86">
        <div className="flex items-baseline gap-3">
          <span className="stopwatch text-5xl leading-none">84</span>
          <Pill tone="sea">High fit</Pill>
        </div>
        <ul className="mt-4 space-y-1.5 text-sm">
          {reasons.map((r) => (
            <li key={r.text} className="flex gap-2">
              <span
                aria-hidden="true"
                className={cn("stopwatch w-3 shrink-0 font-semibold", r.sign === "+" ? "text-sea" : "text-(--coral-ink)")}
              >
                {r.sign}
              </span>
              <span className="sr-only">{r.sign === "+" ? "In favour:" : "Against:"}</span>
              <span>{r.text}</span>
            </li>
          ))}
        </ul>
      </MockCard>
    </div>
  );
}

const rules = [
  ["Days", "Mon–Fri"],
  ["Hours", "09:00–17:00"],
  ["Timezone", "Europe/London"],
  ["Meeting", "30 min"],
  ["Buffer", "10 min"],
  ["Notice", "4 h"],
];

/** Step 3: availability rules in, three real slots out. */
export function SlotsMock() {
  return (
    <div className="grid items-center gap-3 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
      <MockCard label="Availability">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm">
          {rules.map(([k, v]) => (
            <div key={k} className="min-w-0">
              <dt className="text-[0.6875rem] font-semibold text-foreground/70">{k}</dt>
              <dd className="stopwatch mt-0.5 truncate">{v}</dd>
            </div>
          ))}
        </dl>
      </MockCard>
      <Becomes turn />
      <MockCard label="Offered to Priya">
        <ul className="space-y-1.5">
          {heroSlots.map((s) => (
            <SlotLine key={s}>{s}</SlotLine>
          ))}
        </ul>
        <p className="mt-3 text-xs leading-relaxed text-foreground/75">
          Three different days, mornings and afternoons mixed, none sooner than four hours away.
        </p>
      </MockCard>
    </div>
  );
}

/** Step 4: a reply that proposes a new time, classified, checked, booked. */
export function BookMock() {
  return (
    <div className="space-y-3">
      <MockCard label="Reply from Priya" meta="Mon 11:02">
        <p className="text-[0.9375rem] leading-relaxed">&ldquo;Tuesday doesn&rsquo;t work, Thursday afternoon?&rdquo;</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Pill tone="night">Proposes time · Thu 8 Oct 14:00</Pill>
          <Pill tone="quiet">Free in your availability</Pill>
        </div>
      </MockCard>
      <Becomes />
      <div className="rounded-2xl bg-sea p-4 text-sea-foreground shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="pill bg-sea-foreground text-sea">Booked</span>
          <span className="stopwatch text-xs">Mon 11:02:31</span>
        </div>
        <p className="mt-3 font-heading text-xl leading-snug font-bold">Thu 8 Oct, 14:00–14:30 BST</p>
        <p className="text-sm">Priya Raman, Lumen Clinics · 30-minute intro call</p>
        <p className="mt-3 rounded-lg bg-black/15 px-3 py-2 font-mono text-[0.6875rem] break-all">
          invite.ics · DTSTART:20261008T130000Z · DURATION:PT30M
        </p>
      </div>
    </div>
  );
}
