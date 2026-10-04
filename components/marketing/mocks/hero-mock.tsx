import { cn } from "@/lib/utils";
import { MockCard, Pill, SlotLine } from "./parts";
import { StopwatchDial } from "./stopwatch";

export const heroSlots = ["Tue 6 Oct, 10:30–11:00 BST", "Wed 7 Oct, 14:00–14:30 BST", "Thu 8 Oct, 09:30–10:00 BST"];

function LeadCard({ className }: { className?: string }) {
  return (
    <MockCard label="New lead · website form" meta="Mon 09:14:02" className={className}>
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="grid size-10 shrink-0 place-items-center rounded-full bg-accent font-heading text-sm font-bold text-accent-foreground"
        >
          PR
        </span>
        <div className="min-w-0">
          <p className="font-heading text-lg leading-tight font-bold">Priya Raman</p>
          <p className="text-sm text-foreground/75">Operations lead, Lumen Clinics</p>
          <p className="mt-0.5 truncate font-mono text-xs text-foreground/70">priya@lumenclinics.example</p>
        </div>
      </div>
      <blockquote className="mt-4 rounded-xl bg-background px-3.5 py-3 text-[0.9375rem] leading-relaxed">
        &ldquo;We&rsquo;re opening two new sites and need help with patient intake software&hellip; budget approved
        for Q4&rdquo;
      </blockquote>
      <div className="mt-4 flex flex-wrap gap-2">
        <Pill tone="sea">High fit · 84</Pill>
        <Pill tone="lemon">Needs approval</Pill>
      </div>
      <p className="mt-4 border-t border-border pt-3 text-xs leading-relaxed text-foreground/75">
        From <span className="font-mono">lumenclinics.example</span>: physiotherapy clinics in Leeds and York, about
        60 staff.
      </p>
    </MockCard>
  );
}

function ReplyCard({ className }: { className?: string }) {
  return (
    <MockCard label="Drafted reply · to Priya" meta="Mon 09:14:50" className={className}>
      <p className="text-xs text-foreground/70">
        Subject <span className="font-semibold text-foreground">Re: Patient intake for the two new sites</span>
      </p>
      <div className="mt-3 space-y-2.5 text-[0.9375rem] leading-relaxed">
        <p>Hi Priya,</p>
        <p>
          Thanks for getting in touch. Two new sites at once is when intake gets messy, so it&rsquo;s worth a proper
          look before Q4. Would a 30-minute call suit? These times are free:
        </p>
      </div>
      <ul className="mt-3 space-y-1.5">
        {heroSlots.map((s) => (
          <SlotLine key={s}>{s}</SlotLine>
        ))}
      </ul>
      <p className="mt-3 text-[0.9375rem] leading-relaxed">
        Or pick another time:{" "}
        <span className="font-mono text-[0.8125rem] font-medium text-(--coral-ink) underline decoration-1 underline-offset-4">
          /b/fernway
        </span>
      </p>
      <p className="mt-3 text-[0.9375rem]">Sam, Fernway</p>
    </MockCard>
  );
}

/**
 * Hero picture: the lead, the stopwatch, and the reply drafted 48 seconds later.
 * Phones stack lead, timer, reply; tablets put the timer on top with the two
 * cards side by side; wide screens run left to right like a timeline.
 */
export function HeroMock({ className }: { className?: string }) {
  return (
    <figure
      className={cn(
        "grid gap-5 [grid-template-areas:'lead'_'timer'_'reply']",
        "md:grid-cols-2 md:[grid-template-areas:'timer_timer'_'lead_reply']",
        "lg:grid-cols-[minmax(0,1fr)_14rem_minmax(0,1fr)] lg:items-center lg:gap-6 lg:[grid-template-areas:'lead_timer_reply']",
        className,
      )}
    >
      <figcaption className="sr-only">
        Example: a website enquiry from Priya Raman at Lumen Clinics, scored high fit at 84, and the reply Firstreply
        drafted 48 seconds later with three meeting times and a booking link. It waits for your approval.
      </figcaption>
      <LeadCard className="[grid-area:lead]" />
      <div className="flex items-center gap-4 [grid-area:timer] md:justify-center lg:flex-col lg:gap-3 lg:text-center">
        <StopwatchDial className="size-16 text-foreground sm:size-20 lg:size-24" />
        <div>
          <p className="stopwatch text-6xl leading-none sm:text-7xl lg:text-[4.25rem]">00:48</p>
          <p className="mt-2 text-sm font-semibold text-foreground/75">first reply drafted</p>
          <p className="stopwatch mt-1 text-xs text-foreground/70">in 09:14:02 · out 09:14:50</p>
        </div>
      </div>
      <ReplyCard className="[grid-area:reply]" />
    </figure>
  );
}
