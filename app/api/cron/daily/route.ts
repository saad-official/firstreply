import { isAuthorizedCron, unauthorized } from "@/app/api/_lib/secrets";
import { processPendingLeads } from "@/lib/services/intake";
import { runDailyMaintenance } from "@/lib/services/maintenance";
import { sendApprovedMessages } from "@/lib/services/sending";

/**
 * Daily job (vercel.json: 06:00 UTC). `Authorization: Bearer <CRON_SECRET>`.
 * Refreshes stale drafts, drafts due follow-ups, retries failed deliveries,
 * purges leads past retention, then processes any lead a crashed request
 * left behind and sends approved messages. Returns a JSON summary.
 */
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) return unauthorized();
  try {
    const maintenance = await runDailyMaintenance();
    const leads = await processPendingLeads({ limit: 20 });
    const sending = await sendApprovedMessages();
    console.info(
      `[cron] daily: drafts refreshed ${maintenance.drafts.refreshed}, follow-ups ${maintenance.followUps.drafted}, resent ${maintenance.outbox.resent}, purged ${maintenance.purgedLeads}, processed ${leads.processed}, sent ${sending.sent}, errors ${maintenance.errors.length}`,
    );
    return Response.json({ ok: true, maintenance, leads, sending });
  } catch (error) {
    console.error("[cron] daily failed", error instanceof Error ? error.message : error);
    return Response.json({ ok: false, error: "daily job failed" }, { status: 500 });
  }
}
