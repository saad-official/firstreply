import Link from "next/link";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

type CtaLinkProps = ComponentProps<typeof Link> & {
  tone?: "coral" | "night" | "outline" | "cream" | "cream-outline";
  size?: "md" | "lg";
};

/**
 * A link styled as a call to action. Navigation stays a link (not a button),
 * so it works without JavaScript and announces as a link.
 */
export function CtaLink({ tone = "coral", size = "lg", className, ...props }: CtaLinkProps) {
  return (
    <Link
      className={cn(
        "inline-flex shrink-0 items-center justify-center gap-2 rounded-full border font-semibold whitespace-nowrap outline-none select-none",
        "motion-safe:transition-colors",
        "focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2",
        tone === "cream" || tone === "cream-outline" ? null : "focus-visible:outline-foreground",
        size === "lg" ? "h-12 px-6 text-[0.9375rem]" : "h-9 px-4 text-sm",
        tone === "coral" &&
          "border-(--coral-ink) bg-(--coral-ink) text-white hover:border-foreground hover:bg-foreground",
        tone === "night" && "border-foreground bg-foreground text-background hover:bg-foreground/85",
        tone === "outline" && "border-foreground/25 bg-card text-foreground hover:border-foreground",
        tone === "cream" &&
          "border-cream bg-cream text-night hover:bg-transparent hover:text-cream focus-visible:outline-cream",
        tone === "cream-outline" &&
          "border-cream/40 bg-transparent text-cream hover:border-cream focus-visible:outline-cream",
        className,
      )}
      {...props}
    />
  );
}
