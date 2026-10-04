"use client";

import { useId, useState, useTransition } from "react";
import { Archive, CalendarPlus, Loader2, MessageSquareReply, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { archiveLeadAction, bookManuallyAction, reprocessLead, simulateReply } from "@/app/(app)/leads/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { ActionResult } from "./action-result";
import { FormMessage } from "./form-message";

function useAction() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (action: () => Promise<ActionResult>, onOk?: () => void) => {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        toast.success(result.message ?? "Done.");
        onOk?.();
      } else {
        setError(result.error);
        toast.error(result.error);
      }
    });
  };
  return { pending, error, run };
}

export function ReprocessButton({ leadId, disabled }: { leadId: string; disabled?: boolean }) {
  const { pending, run } = useAction();
  return (
    <Button variant="outline" disabled={pending || disabled} onClick={() => run(() => reprocessLead(leadId))}>
      {pending ? <Loader2 className="animate-spin" aria-hidden /> : <RefreshCw aria-hidden />}
      {pending ? "Re-processing" : "Re-process"}
    </Button>
  );
}

export function ArchiveButton({ leadId }: { leadId: string }) {
  const { pending, run } = useAction();
  return (
    <Button variant="ghost" disabled={pending} onClick={() => run(() => archiveLeadAction(leadId))}>
      {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Archive aria-hidden />}
      Archive
    </Button>
  );
}

const SCENARIOS = [
  { value: "accept", label: "Accepts a time", hint: "Picks one of the offered slots. Firstreply books it and sends the invite." },
  { value: "counter", label: "Proposes another time", hint: "None of the slots work. Booked if free, otherwise a counter-offer." },
  { value: "question", label: "Asks a question", hint: "Needs your answer before booking. Lands in the queue." },
  { value: "decline", label: "Not interested", hint: "Politely declines. The lead is closed." },
  { value: "out_of_office", label: "Out of office", hint: "Automatic reply. A follow-up is scheduled for their return." },
] as const;

/** Demo: write a plausible reply from the lead and run it through negotiation. */
export function SimulateReplyDialog({ leadId, leadName }: { leadId: string; leadName: string }) {
  const [open, setOpen] = useState(false);
  const [scenario, setScenario] = useState<(typeof SCENARIOS)[number]["value"]>("accept");
  const { pending, error, run } = useAction();
  const id = useId();
  return (
    <Dialog open={open} onOpenChange={(next) => (pending ? undefined : setOpen(next))}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <MessageSquareReply aria-hidden />
          Simulate lead reply
        </Button>
      </DialogTrigger>
      <DialogContent showCloseButton={!pending}>
        <DialogHeader>
          <DialogTitle>Simulate a reply from {leadName}</DialogTitle>
          <DialogDescription>
            Demo only. Firstreply writes a plausible reply to your last sent offer and handles it like a real one. It is
            marked as simulated in the thread.
          </DialogDescription>
        </DialogHeader>
        <fieldset className="grid gap-2" disabled={pending}>
          <legend className="sr-only">Scenario</legend>
          {SCENARIOS.map((s) => (
            <label
              key={s.value}
              htmlFor={`${id}-${s.value}`}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-xl border border-border p-3 transition-colors has-focus-visible:ring-3 has-focus-visible:ring-ring/50",
                scenario === s.value && "border-coral-ink bg-accent",
              )}
            >
              <input
                id={`${id}-${s.value}`}
                type="radio"
                name="scenario"
                value={s.value}
                checked={scenario === s.value}
                onChange={() => setScenario(s.value)}
                className="mt-1 accent-(--coral-ink)"
              />
              <span>
                <span className="block text-sm font-semibold">{s.label}</span>
                <span className="block text-xs text-muted-foreground">{s.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <FormMessage error={error} />
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button disabled={pending} onClick={() => run(() => simulateReply({ leadId, scenario }), () => setOpen(false))}>
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {pending ? "Writing the reply" : "Simulate reply"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Owner books a time by hand (read in the workspace time zone). */
export function BookManuallyDialog({ leadId, timezone, minutes }: { leadId: string; timezone: string; minutes: number }) {
  const [open, setOpen] = useState(false);
  const [when, setWhen] = useState("");
  const { pending, error, run } = useAction();
  const id = useId();
  return (
    <Dialog open={open} onOpenChange={(next) => (pending ? undefined : setOpen(next))}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <CalendarPlus aria-hidden />
          Book manually
        </Button>
      </DialogTrigger>
      <DialogContent showCloseButton={!pending}>
        <DialogHeader>
          <DialogTitle>Book a meeting by hand</DialogTitle>
          <DialogDescription>
            A {minutes}-minute meeting at the time you pick ({timezone}). The lead gets the confirmation with a calendar
            invite. Overlapping bookings are refused.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-when`}>Start ({timezone})</Label>
          <Input
            id={`${id}-when`}
            type="datetime-local"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
            disabled={pending}
            required
          />
        </div>
        <FormMessage error={error} />
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            disabled={pending || !when}
            onClick={() => run(() => bookManuallyAction({ leadId, when: when.slice(0, 16) }), () => setOpen(false))}
          >
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            Book and send invite
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
