import Link from "next/link";
import { cn } from "@/lib/utils";
import { focusRing } from "./site";

/**
 * The coral dot: an unread-message indicator. It pulses only when the visitor
 * has not asked for reduced motion; otherwise it is a still dot.
 */
export function Dot({ className }: { className?: string }) {
  return (
    <span aria-hidden="true" className={cn("relative inline-flex size-2.5 shrink-0", className)}>
      <span className="absolute inset-0 rounded-full bg-coral opacity-60 motion-safe:animate-ping motion-safe:[animation-iteration-count:5]" />
      <span className="relative inline-flex size-2.5 rounded-full bg-coral" />
    </span>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <Link href="/" aria-label="Firstreply, home" className={cn("inline-flex items-center gap-2", focusRing, className)}>
      <span className="font-heading text-[1.375rem] leading-none font-bold tracking-tight">Firstreply</span>
      <Dot className="-mt-3" />
    </Link>
  );
}
