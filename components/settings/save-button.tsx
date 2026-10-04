"use client";

import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Submit button driven by an explicit `pending` flag (for forms submitted through `onSubmit`). */
export function SaveButton({
  pending,
  children,
  pendingLabel,
  ...props
}: React.ComponentProps<typeof Button> & { pending: boolean; pendingLabel: string }) {
  return (
    <Button type="submit" size="lg" disabled={pending || props.disabled} {...props}>
      {pending ? (
        <>
          <Loader2 className="animate-spin" aria-hidden />
          {pendingLabel}
        </>
      ) : (
        children
      )}
    </Button>
  );
}
