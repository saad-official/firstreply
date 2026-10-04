import { Zap } from "lucide-react";
import type { QueueExplanation } from "@/lib/services/queue-reasons";

/** "Why it waits" list for a draft, plus a Pro auto-send hint when it applies. */
export function WaitReasons({ explanation, showProHint = true }: { explanation: QueueExplanation; showProHint?: boolean }) {
  return (
    <div className="rounded-xl bg-lemon/20 p-3 ring-1 ring-lemon/60 dark:bg-lemon/10">
      <p className="text-xs font-semibold text-lemon-foreground dark:text-lemon">Why it waits</p>
      <ul className="mt-1.5 grid gap-1 text-sm">
        {explanation.reasons.map((r) => (
          <li key={r.code} className="flex gap-2">
            <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-lemon-foreground/60 dark:bg-lemon" />
            <span>{r.text}</span>
          </li>
        ))}
      </ul>
      {showProHint && explanation.couldAutoSendOnPro ? (
        <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-sea">
          <Zap className="size-3.5" aria-hidden />
          High fit and confident: with Pro auto-reply this would have gone out on its own.
        </p>
      ) : null}
    </div>
  );
}
