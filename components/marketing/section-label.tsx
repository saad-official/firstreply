import { cn } from "@/lib/utils";

/**
 * Section eyebrow written like a stopwatch lap: a mono time, then a word.
 * Decorative framing for the heading that follows; it is plain text, not a heading.
 */
export function SectionLabel({
  lap,
  children,
  className,
  onDark = false,
}: {
  lap?: string;
  children: React.ReactNode;
  className?: string;
  onDark?: boolean;
}) {
  return (
    <p
      className={cn(
        "flex items-center gap-2.5 text-[0.8125rem] font-semibold",
        onDark ? "text-cream/80" : "text-foreground/75",
        className,
      )}
    >
      {lap ? (
        <span className={cn("stopwatch rounded-full px-2 py-0.5 text-xs", onDark ? "bg-cream/10" : "bg-foreground/[0.06]")}>
          {lap}
        </span>
      ) : null}
      <span>{children}</span>
    </p>
  );
}
