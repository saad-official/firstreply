import { cn } from "@/lib/utils";

const tiles = [
  { label: "Median first reply", value: "0:52", note: "vs 47 h benchmark", lead: true },
  { label: "Reply rate", value: "100%", note: "64 of 64 leads" },
  { label: "Qualified", value: "38%", note: "high or medium fit" },
  { label: "Meetings booked", value: "11", note: "from 24 qualified" },
  { label: "No-shows", value: "1", note: "marked by you" },
];

/** Dashboard tiles as the app shows them, with synthetic numbers. */
export function DashboardMock({ className }: { className?: string }) {
  return (
    <figure className={cn("min-w-0", className)}>
      <ul className="grid grid-cols-2 gap-3 md:grid-cols-6 lg:grid-cols-5">
        {tiles.map((t) => (
          <li
            key={t.label}
            className={cn(
              "flex min-w-0 flex-col rounded-2xl bg-card p-4 shadow-card ring-1 ring-foreground/10",
              t.lead ? "col-span-2 md:col-span-6 lg:col-span-1 lg:row-span-1" : "md:col-span-3 lg:col-span-1",
            )}
          >
            <span className="text-xs font-semibold text-foreground/75">{t.label}</span>
            <span className={cn("stopwatch mt-3 text-4xl leading-none", t.lead && "text-(--coral-ink)")}>{t.value}</span>
            <span className="mt-2 text-xs text-foreground/70">{t.note}</span>
            {t.lead ? (
              <span aria-hidden="true" className="mt-4 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 gap-y-1.5">
                {/* Drawn to scale: 52 seconds is 0.03% of 47 hours, so the coral bar is a sliver. */}
                <span className="stopwatch text-[0.6875rem] text-foreground/75">0:52</span>
                <span className="block h-1.5 w-0.5 rounded-full bg-coral" />
                <span className="stopwatch text-[0.6875rem] text-foreground/75">47 h</span>
                <span className="block h-1.5 w-full rounded-full bg-foreground/25" />
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      <figcaption className="mt-3 text-xs text-foreground/70">
        Example workspace, last 30 days. Synthetic data from the demo.
      </figcaption>
    </figure>
  );
}
