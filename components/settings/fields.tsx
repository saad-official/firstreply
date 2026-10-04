import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/** Native <select> styled like the shadcn Input (keeps server render and keyboard behaviour simple). */
export const selectClass =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2 py-1 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30";

/** Label + control + optional hint, with the hint wired to the control by `aria-describedby` at the call site. */
export function Field({
  id,
  label,
  hint,
  className,
  children,
}: {
  id: string;
  label: React.ReactNode;
  hint?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("grid min-w-0 content-start gap-1.5", className)}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint ? (
        <p id={`${id}-hint`} className="text-xs leading-relaxed text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** One settings section: an anchor target with an h2, a short lede and a white card. */
export function SettingsSection({
  id,
  title,
  description,
  aside,
  children,
}: {
  id: string;
  title: string;
  description?: React.ReactNode;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="scroll-mt-24">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <h2 id={`${id}-heading`} className="font-heading text-xl">
            {title}
          </h2>
          {description ? <p className="max-w-2xl text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function Panel({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("rounded-2xl bg-card p-4 shadow-card ring-1 ring-foreground/10 sm:p-6", className)}>
      {children}
    </div>
  );
}
