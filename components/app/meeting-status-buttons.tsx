"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { markMeeting } from "@/app/(app)/meetings/actions";
import { Button } from "@/components/ui/button";

/** Held / no-show for past meetings, cancel for upcoming ones. */
export function MeetingStatusButtons({ meetingId, past, label }: { meetingId: string; past: boolean; label: string }) {
  const [pending, startTransition] = useTransition();
  const run = (status: "held" | "no_show" | "cancelled") =>
    startTransition(async () => {
      const result = await markMeeting({ meetingId, status });
      if (result.ok) toast.success(result.message ?? "Saved.");
      else toast.error(result.error);
    });
  if (past) {
    return (
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={`Outcome of ${label}`}>
        <Button size="sm" variant="outline" disabled={pending} onClick={() => run("held")}>
          Held
        </Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => run("no_show")}>
          No-show
        </Button>
      </div>
    );
  }
  return (
    <Button size="sm" variant="ghost" disabled={pending} onClick={() => run("cancelled")} aria-label={`Cancel ${label}`}>
      Cancel
    </Button>
  );
}
