import { cn } from "@/lib/utils";

/**
 * Building blocks for the product fragments on the marketing pages. These are
 * static pictures of the UI, not working controls, so nothing in them is focusable.
 */

export function MockCard({
  label,
  meta,
  className,
  children,
}: {
  label: string;
  meta?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("min-w-0 rounded-2xl bg-card shadow-card ring-1 ring-foreground/10", className)}>
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <span className="truncate text-xs font-semibold text-foreground/75">{label}</span>
        {meta ? <span className="stopwatch shrink-0 text-xs text-foreground/70">{meta}</span> : null}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

type PillTone = "sea" | "lemon" | "coral" | "night" | "quiet";

const pillTone: Record<PillTone, string> = {
  sea: "bg-sea text-sea-foreground",
  lemon: "bg-lemon text-lemon-foreground",
  coral: "bg-(--coral-ink) text-white",
  night: "bg-foreground text-background",
  quiet: "bg-foreground/[0.06] text-foreground/80",
};

export function Pill({ tone, className, children }: { tone: PillTone; className?: string; children: React.ReactNode }) {
  return <span className={cn("pill", pillTone[tone], className)}>{children}</span>;
}

/** A slot as it appears in a drafted reply: mono, tabular, one per line. */
export function SlotLine({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <li
      className={cn(
        "stopwatch flex items-center gap-2.5 rounded-xl border border-border bg-background px-3 py-2 text-[0.8125rem] text-foreground",
        className,
      )}
    >
      <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-sea" />
      <span className="min-w-0">{children}</span>
    </li>
  );
}

/** Faux input: looks like a field in the app, but is plain text here. */
export function FauxField({ label, children, mono = false }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div>
      <p className="text-[0.6875rem] font-semibold text-foreground/70">{label}</p>
      <p
        className={cn(
          "mt-1 rounded-lg border border-input bg-background px-2.5 py-1.5 text-[0.8125rem] text-foreground",
          mono && "font-mono text-xs break-all",
        )}
      >
        {children}
      </p>
    </div>
  );
}

/** A small "becomes" arrow between two fragments; points down on phones, right on wide screens when `turn` is set. */
export function Becomes({ turn = false, label }: { turn?: boolean; label?: string }) {
  return (
    <div aria-hidden="true" className={cn("flex items-center justify-center gap-2 text-foreground/60", turn && "lg:flex-col")}>
      <svg viewBox="0 0 16 16" className={cn("size-4 rotate-90", turn && "lg:rotate-0")} fill="none">
        <path d="M2 8h11M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {label ? <span className="stopwatch text-[0.6875rem]">{label}</span> : null}
    </div>
  );
}
