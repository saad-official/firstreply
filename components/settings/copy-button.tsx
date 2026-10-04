"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Copies `value` to the clipboard. `label` is the accessible name, e.g. "Copy booking link". */
export function CopyButton({
  value,
  label,
  className,
  variant = "outline",
}: {
  value: string;
  label: string;
  className?: string;
  variant?: "outline" | "ghost" | "secondary";
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success("Copied to the clipboard.");
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error("Copy failed. Select the text and copy it by hand.");
    }
  }

  return (
    <Button type="button" variant={variant} size="sm" onClick={copy} className={cn("shrink-0", className)}>
      {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
      <span className="sr-only">{label}</span>
      <span aria-hidden>{copied ? "Copied" : "Copy"}</span>
    </Button>
  );
}

/** A long URL or snippet in a mono box that wraps on small screens, with a copy button. */
export function CopyField({
  value,
  label,
  multiline = false,
  className,
}: {
  value: string;
  label: string;
  multiline?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 gap-2 rounded-lg bg-muted/70 p-1.5 pl-3 ring-1 ring-foreground/5",
        multiline ? "flex-col sm:flex-row sm:items-start" : "items-center",
        className,
      )}
    >
      <pre
        className={cn(
          "min-w-0 flex-1 font-mono text-xs leading-relaxed text-foreground/90",
          multiline ? "overflow-x-auto py-1.5 whitespace-pre-wrap break-all" : "py-1 whitespace-normal break-all",
        )}
      >
        {value}
      </pre>
      <CopyButton value={value} label={label} className={multiline ? "self-end sm:self-start" : undefined} />
    </div>
  );
}
