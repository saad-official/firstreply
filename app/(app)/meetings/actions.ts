"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/components/app/action-result";
import { requireOrgContext } from "@/lib/auth/session";
import { setMeetingStatus } from "@/lib/services/booking";
import { actionError, uuidSchema } from "../_lib/action-errors";

const Schema = z.object({ meetingId: uuidSchema, status: z.enum(["held", "no_show", "cancelled"]) });

const DONE: Record<z.infer<typeof Schema>["status"], string> = {
  held: "Marked as held.",
  no_show: "Marked as a no-show.",
  cancelled: "Meeting cancelled; the time is free again.",
};

/** Owner marks a meeting held / no-show (spec 3.6 no-show rate) or cancels it. */
export async function markMeeting(input: { meetingId: string; status: string }): Promise<ActionResult> {
  const { user, org } = await requireOrgContext();
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Unknown meeting." };
  try {
    await setMeetingStatus(org.id, parsed.data.meetingId, parsed.data.status, user.id);
    revalidatePath("/meetings");
    revalidatePath("/dashboard");
    return { ok: true, message: DONE[parsed.data.status] };
  } catch (error) {
    return actionError(error, "mark meeting");
  }
}
