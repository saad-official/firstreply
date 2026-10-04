import { cn } from "@/lib/utils";

export function MetricTile({
  label,
  value,
  caption,
  tone = "default",
  className,
}: {
  label: string;
  /** Pre-formatted value, e.g. "38s" or "3". */
  value: string;
  caption?: string;
  /** "positive" is sea (booked, good); "attention" is lemon ink (needs approval); "primary" is coral. */
  tone?: "default" | "positive" | "attention" | "primary";
  className?: string;
}) {
  return (
    <div className={cn("rounded-xl bg-card p-4 shadow-card ring-1 ring-foreground/10", className)}>
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
      <p
        className={cn(
          "tabular mt-2 font-heading text-3xl leading-none",
          tone === "positive" && "text-sea",
          tone === "attention" && "text-lemon-foreground",
          tone === "primary" && "text-coral",
        )}
      >
        {value}
      </p>
      {caption ? <p className="mt-2 text-xs text-muted-foreground">{caption}</p> : null}
    </div>
  );
}
