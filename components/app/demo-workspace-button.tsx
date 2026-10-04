"use client";

import { useActionState } from "react";
import { FlaskConical, Loader2 } from "lucide-react";
import { loadDemoWorkspace } from "@/app/(app)/dashboard/actions";
import { Button } from "@/components/ui/button";
import { initialFormState } from "./action-result";
import { FormMessage } from "./form-message";

/** Seeds six synthetic leads through the real pipeline, then the action redirects to the queue. */
export function DemoWorkspaceButton({ variant = "default" }: { variant?: "default" | "outline" }) {
  const [state, formAction, pending] = useActionState(loadDemoWorkspace, initialFormState);
  return (
    <form action={formAction} className="grid justify-items-start gap-2">
      <Button type="submit" variant={variant} size="lg" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : <FlaskConical aria-hidden />}
        {pending ? "Loading the demo workspace" : "Load demo workspace"}
      </Button>
      {pending ? (
        <p role="status" className="max-w-sm text-xs text-muted-foreground">
          Scoring six fictional leads and drafting replies with real slots. This takes up to a minute.
        </p>
      ) : null}
      <FormMessage error={state.error} upgradeUrl={state.upgradeUrl} className="max-w-sm" />
    </form>
  );
}
