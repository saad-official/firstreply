"use client";

import { useOptimistic, useState, useTransition } from "react";
import Link from "next/link";
import { setAutonomyAction } from "@/app/(app)/settings/actions";
import { FormMessage } from "@/components/app/form-message";
import { Pill } from "@/components/app/pills";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toastResult } from "./use-toast-action";

/**
 * Auto-reply for high-fit leads (Pro). On Free the switch is disabled with an
 * upgrade nudge, unless it is somehow on (e.g. after a downgrade), in which
 * case the owner can still turn it off.
 */
export function AutonomyToggle({ enabled, isPro }: { enabled: boolean; isPro: boolean }) {
  const [optimistic, setOptimistic] = useOptimistic(enabled);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<{ error: string; upgradeUrl?: string } | null>(null);
  const locked = !isPro && !enabled;

  function onChange(next: boolean) {
    setError(null);
    startTransition(async () => {
      setOptimistic(next);
      const result = await setAutonomyAction(next);
      toastResult(result);
      if (!result.ok) setError({ error: result.error, upgradeUrl: result.upgradeUrl });
    });
  }

  return (
    <div className="grid gap-4">
      <div className="flex items-start justify-between gap-4">
        <div className="grid min-w-0 gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <Label htmlFor="autonomy-switch" className="text-base font-semibold">
              Auto-reply to high-fit leads
            </Label>
            <Pill tone="night">Pro</Pill>
          </div>
          <p id="autonomy-desc" className="text-sm text-muted-foreground">
            When on, a first reply is sent without waiting for you if the lead scores{" "}
            <span className="stopwatch text-foreground">≥ 70</span> with confidence{" "}
            <span className="stopwatch text-foreground">≥ 0.8</span> and the draft passes every check. Declines,
            drafts that mention pricing and anything the model is unsure about still wait in your queue.
          </p>
        </div>
        <Switch
          id="autonomy-switch"
          checked={optimistic}
          onCheckedChange={onChange}
          disabled={locked || pending}
          aria-describedby="autonomy-desc autonomy-status"
          className="mt-1"
        />
      </div>

      <p id="autonomy-status" className="stopwatch rounded-xl bg-muted/60 px-3 py-2 text-xs text-foreground/80">
        {optimistic ? "send if score ≥ 70 and confidence ≥ 0.8 · otherwise wait" : "every reply waits for approval"}
      </p>

      {locked ? (
        <p className="rounded-xl border border-lemon bg-lemon/20 px-3 py-2.5 text-sm text-lemon-foreground dark:text-lemon">
          You&apos;re on Free, so every reply waits for your approval in the queue.{" "}
          <Link href="/billing" className="font-semibold underline underline-offset-3">
            Upgrade to Pro
          </Link>{" "}
          to let Firstreply answer your best-fit leads on its own.
        </p>
      ) : null}

      <FormMessage error={error?.error} upgradeUrl={error?.upgradeUrl} />
    </div>
  );
}
