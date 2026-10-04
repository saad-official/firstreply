"use client";

import { useActionState } from "react";
import { ArrowUpRight, Loader2 } from "lucide-react";
import { openPortal, startCheckout } from "@/app/(app)/billing/actions";
import { initialFormState } from "@/components/app/action-result";
import { FormMessage } from "@/components/app/form-message";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function StripeButton({
  action,
  field,
  label,
  pendingLabel,
  disabled,
  describedBy,
  variant,
  className,
}: {
  action: typeof startCheckout;
  field: { name: string; value: string };
  label: string;
  pendingLabel: string;
  disabled: boolean;
  describedBy?: string;
  variant: "default" | "outline" | "secondary";
  className?: string;
}) {
  const [state, formAction, pending] = useActionState(action, initialFormState);
  return (
    <form action={formAction} className="grid gap-2">
      <input type="hidden" name={field.name} value={field.value} />
      <Button
        type="submit"
        size="lg"
        variant={variant}
        disabled={disabled || pending}
        aria-describedby={describedBy}
        className={cn("h-10 w-full sm:w-auto", className)}
      >
        {pending ? (
          <>
            <Loader2 className="animate-spin" aria-hidden />
            {pendingLabel}
          </>
        ) : (
          <>
            {label}
            <ArrowUpRight aria-hidden />
          </>
        )}
      </Button>
      <FormMessage error={state.ok ? null : state.error} className="bg-card" />
    </form>
  );
}

export function UpgradeButton({ disabled, describedBy }: { disabled: boolean; describedBy?: string }) {
  return (
    <StripeButton
      action={startCheckout}
      field={{ name: "plan", value: "pro" }}
      label="Upgrade to Pro"
      pendingLabel="Opening Stripe Checkout"
      disabled={disabled}
      describedBy={describedBy}
      variant="default"
    />
  );
}

export function ManageButton({ disabled, onDark = false }: { disabled: boolean; onDark?: boolean }) {
  return (
    <StripeButton
      action={openPortal}
      field={{ name: "intent", value: "manage" }}
      label="Manage subscription"
      pendingLabel="Opening Stripe"
      disabled={disabled}
      variant="outline"
      className={onDark ? "border-background/30 bg-transparent text-background hover:bg-background/10 hover:text-background" : undefined}
    />
  );
}
