import "server-only";
import type { IngestResult } from "./intake";
import { processLead } from "./intake";
import { handleInboundReply } from "./negotiation";
import { errorText } from "./shared";

/**
 * Work that runs after an intake response is sent (Next `after()`): process
 * a new lead, or run a merged follow-up message through negotiation when the
 * thread is live. Failures are logged; the cron tick retries unprocessed
 * leads.
 */
export async function runIntakeFollowUp(orgId: string, result: IngestResult): Promise<void> {
  try {
    if (result.needsProcessing) {
      await processLead(orgId, result.lead.id, { actor: "agent" });
    } else if (result.needsNegotiation && result.inboundMessage) {
      await handleInboundReply(orgId, result.lead.id, result.inboundMessage.body, result.inboundMessage.createdAt, {
        existingMessageId: result.inboundMessage.id,
      });
    }
  } catch (error) {
    console.error("[intake] background processing failed", result.lead.id, errorText(error));
  }
}
