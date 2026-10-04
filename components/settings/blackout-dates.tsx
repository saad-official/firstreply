"use client";

import { useState, useTransition } from "react";
import { Loader2, X } from "lucide-react";
import { addBlackoutAction, removeBlackoutAction } from "@/app/(app)/settings/actions";
import { FormMessage } from "@/components/app/form-message";
import { SubmitButton } from "@/components/app/submit-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "./fields";
import { toastResult, useToastAction } from "./use-toast-action";

export type BlackoutItem = { id: string; date: string; label: string; reason: string | null; past: boolean };

export function BlackoutDates({ items, today }: { items: BlackoutItem[]; today: string }) {
  const { state, formAction } = useToastAction(addBlackoutAction);
  const [removing, setRemoving] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function remove(id: string) {
    setRemoving(id);
    startTransition(async () => {
      const result = await removeBlackoutAction(id);
      toastResult(result);
      setRemoving(null);
    });
  }

  return (
    <div className="grid gap-4">
      {items.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-5 text-sm text-muted-foreground">
          No blackout dates. Add holidays or days off and no slots are offered on them.
        </p>
      ) : (
        <ul className="grid gap-2" aria-label="Blackout dates">
          {items.map((b) => (
            <li
              key={b.id}
              className="flex items-center justify-between gap-3 rounded-xl bg-muted/50 py-2 pr-2 pl-3 ring-1 ring-foreground/5"
            >
              <div className="min-w-0">
                <p className="stopwatch text-sm">
                  {b.label}
                  {b.past ? <span className="ml-2 font-sans text-xs font-normal text-muted-foreground">past</span> : null}
                </p>
                {b.reason ? <p className="truncate text-xs text-muted-foreground">{b.reason}</p> : null}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => remove(b.id)}
                disabled={removing === b.id}
                aria-label={`Remove blackout on ${b.label}`}
              >
                {removing === b.id ? <Loader2 className="animate-spin" aria-hidden /> : <X aria-hidden />}
              </Button>
            </li>
          ))}
        </ul>
      )}

      <form action={formAction} className="grid gap-3 rounded-xl border border-dashed p-3 sm:p-4">
        <p className="text-sm font-medium">Add a blackout date</p>
        <div className="grid gap-3 sm:grid-cols-[11rem_1fr_auto] sm:items-end">
          <Field id="blackout-date" label="Date">
            <Input id="blackout-date" name="date" type="date" min={today} required className="stopwatch" />
          </Field>
          <Field id="blackout-reason" label="Reason (optional)">
            <Input id="blackout-reason" name="reason" maxLength={200} placeholder="Bank holiday" />
          </Field>
          <SubmitButton pendingLabel="Adding" variant="outline" size="lg">
            Add date
          </SubmitButton>
        </div>
        <FormMessage error={state.ok ? null : state.error} upgradeUrl={state.upgradeUrl} />
      </form>
    </div>
  );
}
