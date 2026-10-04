"use client";

import { useState, useTransition } from "react";
import { Loader2, Plus } from "lucide-react";
import { createTokenAction, revokeTokenAction } from "@/app/(app)/settings/actions";
import { FormMessage } from "@/components/app/form-message";
import { Pill } from "@/components/app/pills";
import { SubmitButton } from "@/components/app/submit-button";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { CopyField } from "./copy-button";
import { Field } from "./fields";
import { toastResult, useToastAction } from "./use-toast-action";

/**
 * A webhook token as the screen sees it. `endpoint` is set only for active
 * tokens; revoked ones arrive already masked from the server, so their secret
 * never reaches the browser.
 */
export type TokenItem = {
  id: string;
  label: string;
  endpoint: string | null;
  masked: string;
  createdLabel: string;
  lastUsedLabel: string | null;
  revokedLabel: string | null;
};

export function WebhookTokens({ tokens, activeLimit }: { tokens: TokenItem[]; activeLimit: number | null }) {
  const { state, formAction } = useToastAction(createTokenAction);
  const [confirming, setConfirming] = useState<TokenItem | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const activeCount = tokens.filter((t) => !t.revokedLabel).length;

  function revoke() {
    if (!confirming) return;
    const token = confirming;
    setRevokeError(null);
    startTransition(async () => {
      const result = await revokeTokenAction(token.id);
      toastResult(result);
      if (result.ok) setConfirming(null);
      else setRevokeError(result.error);
    });
  }

  return (
    <div className="grid gap-5">
      {tokens.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-5 text-sm text-muted-foreground">
          No webhook endpoints yet. Create one, then paste it into Typeform, Tally, Webflow, Framer or anything that
          can send a POST request.
        </p>
      ) : (
        <ul className="grid gap-3">
          {tokens.map((t) => (
            <li
              key={t.id}
              className={
                t.revokedLabel
                  ? "grid gap-2 rounded-2xl border border-dashed p-4 text-muted-foreground"
                  : "grid gap-3 rounded-2xl bg-background/60 p-4 ring-1 ring-foreground/10"
              }
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="grid min-w-0 gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="min-w-0 text-base font-semibold break-words text-foreground">{t.label}</h3>
                    {t.revokedLabel ? <Pill tone="quiet">Revoked</Pill> : <Pill tone="sea">Active</Pill>}
                  </div>
                  <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                    <div className="flex gap-1">
                      <dt className="text-muted-foreground">Created</dt>
                      <dd className="stopwatch">{t.createdLabel}</dd>
                    </div>
                    <div className="flex gap-1">
                      <dt className="text-muted-foreground">Last used</dt>
                      <dd className="stopwatch">{t.lastUsedLabel ?? "never"}</dd>
                    </div>
                    {t.revokedLabel ? (
                      <div className="flex gap-1">
                        <dt className="text-muted-foreground">Revoked</dt>
                        <dd className="stopwatch">{t.revokedLabel}</dd>
                      </div>
                    ) : null}
                  </dl>
                </div>
                {!t.revokedLabel ? (
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={() => {
                      setRevokeError(null);
                      setConfirming(t);
                    }}
                  >
                    Revoke<span className="sr-only"> {t.label}</span>
                  </Button>
                ) : null}
              </div>
              {t.endpoint ? (
                <CopyField value={t.endpoint} label={`Copy endpoint for ${t.label}`} />
              ) : (
                <p className="font-mono text-xs break-all">
                  <span className="sr-only">Revoked endpoint, token hidden: </span>
                  {t.masked}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      <form action={formAction} className="grid gap-3 rounded-xl border border-dashed p-3 sm:p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm font-medium">Create an endpoint</p>
          <p className="text-xs text-muted-foreground">
            <span className="stopwatch text-foreground">{activeCount}</span>
            {activeLimit === null ? " active, no limit on Pro" : ` of ${activeLimit} active on Free`}
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <Field id="new-token-label" label="Where it will be installed (label)">
            <Input id="new-token-label" name="label" maxLength={80} placeholder="Typeform contact form" />
          </Field>
          <SubmitButton pendingLabel="Creating" size="lg">
            <Plus aria-hidden />
            Create endpoint
          </SubmitButton>
        </div>
        <FormMessage error={state.ok ? null : state.error} upgradeUrl={state.upgradeUrl} />
      </form>

      <Dialog open={confirming !== null} onOpenChange={(open) => (!open && !pending ? setConfirming(null) : undefined)}>
        <DialogContent showCloseButton={!pending}>
          <DialogHeader>
            <DialogTitle className="text-lg">Revoke this endpoint?</DialogTitle>
            <DialogDescription>
              Submissions sent to the <span className="font-medium text-foreground">{confirming?.label}</span> endpoint
              will be refused from now on. Leads it already delivered stay. This can&apos;t be undone; you can create a
              new endpoint at any time.
            </DialogDescription>
          </DialogHeader>
          <FormMessage error={revokeError} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(null)} disabled={pending}>
              Keep it
            </Button>
            <Button variant="destructive" onClick={revoke} disabled={pending}>
              {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {pending ? "Revoking" : "Revoke endpoint"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
