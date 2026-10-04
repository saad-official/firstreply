import { cn } from "@/lib/utils";

/**
 * Plain, server-renderable form controls for the public pages. Native
 * elements so the hosted form posts without JavaScript; 44px tall for touch;
 * a night border on focus (the default coral ring is too faint on cream).
 */

export const controlClass = cn(
  "block w-full min-w-0 rounded-xl border border-input bg-background px-3.5 text-base text-foreground",
  "placeholder:text-foreground/45 outline-none motion-safe:transition-colors",
  "focus-visible:border-foreground focus-visible:ring-3 focus-visible:ring-foreground/15",
  "aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/15",
  "disabled:cursor-not-allowed disabled:opacity-60",
);

export const inputClass = cn(controlClass, "h-11");
export const textareaClass = cn(controlClass, "min-h-32 resize-y py-2.5 leading-relaxed");
export const selectClass = cn(controlClass, "h-11 appearance-none pr-10");

/** Wraps a native `<select>` (styled with `selectClass`) and draws its chevron. */
export function SelectFrame({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("relative min-w-0", className)}>
      {children}
      <svg
        aria-hidden="true"
        viewBox="0 0 16 16"
        fill="none"
        className="pointer-events-none absolute top-1/2 right-3.5 size-4 -translate-y-1/2 text-foreground/60"
      >
        <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

/** Coral-ink primary button: white label, night on hover, solid night focus outline. */
export const primaryButtonClass = cn(
  "inline-flex h-12 w-full items-center justify-center gap-2 rounded-full border border-(--coral-ink) bg-(--coral-ink) px-6",
  "text-[0.9375rem] font-semibold whitespace-nowrap text-white outline-none select-none motion-safe:transition-colors",
  "hover:border-foreground hover:bg-foreground",
  "focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-foreground",
  "aria-disabled:cursor-progress aria-disabled:opacity-80 disabled:cursor-progress disabled:opacity-80",
);

/** Label, optional marker, control, then hint or error (error wins). */
export function FieldRow({
  id,
  label,
  required = false,
  hint,
  error,
  className,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("grid min-w-0 gap-1.5", className)}>
      <label htmlFor={id} className="flex items-baseline gap-2 text-sm font-semibold text-foreground">
        {label}
        {required ? null : <span className="text-xs font-normal text-foreground/60">optional</span>}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-sm font-medium text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-foreground/65">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** `aria-describedby` for a FieldRow's control. */
export function describedBy(id: string, { error, hint }: { error?: string; hint?: string }): string | undefined {
  return error ? `${id}-error` : hint ? `${id}-hint` : undefined;
}

/** Form-level message, announced when it appears. */
export function FormAlert({ id, title, children }: { id?: string; title?: string; children: React.ReactNode }) {
  return (
    <div
      id={id}
      role="alert"
      tabIndex={id ? -1 : undefined}
      className="flex gap-3 rounded-2xl border border-destructive/25 bg-destructive/[0.06] px-4 py-3 text-sm text-foreground outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
    >
      <span aria-hidden="true" className="mt-1.5 size-2 shrink-0 rounded-full bg-destructive" />
      <div className="min-w-0">
        {title ? <p className="font-semibold text-destructive">{title}</p> : null}
        <p className={cn(title && "mt-0.5", "text-foreground/85")}>{children}</p>
      </div>
    </div>
  );
}
