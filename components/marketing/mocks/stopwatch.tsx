import { cn } from "@/lib/utils";
import styles from "../marketing.module.css";

/**
 * The first-response stopwatch: a 60-second dial with a coral sweep to the
 * elapsed second, and the elapsed time in mono beside it. The sweep animates
 * once under motion-safe (see marketing.module.css); the numbers never change.
 */
export function StopwatchDial({ className, seconds = 48 }: { className?: string; seconds?: number }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 120 120" aria-hidden="true" className={cn("shrink-0 -rotate-90", className)}>
      {/* Sixty tick marks: a dashed ring whose dash period is one second. */}
      <circle
        cx="60"
        cy="60"
        r={r}
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.22"
        strokeWidth="7"
        strokeDasharray={`1.2 ${c / 60 - 1.2}`}
      />
      <circle
        cx="60"
        cy="60"
        r={r}
        fill="none"
        stroke="var(--coral)"
        strokeWidth="7"
        className={seconds === 48 ? styles.sweep : undefined}
        style={seconds === 48 ? undefined : { strokeDasharray: c, strokeDashoffset: c * (1 - seconds / 60) }}
      />
      <circle cx="60" cy="60" r="4" fill="var(--coral)" />
    </svg>
  );
}

export function Stopwatch({
  time = "00:48",
  label = "first reply drafted",
  className,
  size = "lg",
}: {
  time?: string;
  label?: string;
  className?: string;
  size?: "lg" | "md";
}) {
  return (
    <div className={cn("flex items-center gap-4", className)}>
      <StopwatchDial className={size === "lg" ? "size-16 sm:size-20" : "size-12"} />
      <div>
        <p
          className={cn(
            "stopwatch leading-none text-foreground",
            size === "lg" ? "text-6xl sm:text-7xl" : "text-4xl",
          )}
        >
          {time}
        </p>
        <p className="mt-2 text-sm font-semibold text-foreground/75">{label}</p>
      </div>
    </div>
  );
}
