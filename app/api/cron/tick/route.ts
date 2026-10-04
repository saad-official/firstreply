import { isAuthorizedCron, unauthorized } from "@/app/api/_lib/secrets";
import { processPendingLeads } from "@/lib/services/intake";
import { sendApprovedMessages } from "@/lib/services/sending";

/**
 * Frequent tick for manual or external triggering (an uptime pinger, GitHub
 * Actions): processes leads still "new" and unscored, then sends approved
 * messages. Vercel Hobby only allows daily crons, so vercel.json schedules
 * /api/cron/daily only. `Authorization: Bearer <CRON_SECRET>`.
 */
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) return unauthorized();
  try {
    const leads = await processPendingLeads({ limit: 10 });
    const sending = await sendApprovedMessages();
    return Response.json({ ok: true, leads, sending });
  } catch (error) {
    console.error("[cron] tick failed", error instanceof Error ? error.message : error);
    return Response.json({ ok: false, error: "tick failed" }, { status: 500 });
  }
}
