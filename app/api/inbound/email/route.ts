import { z } from "zod";
import { isAuthorizedCron } from "@/app/api/_lib/secrets";
import { getOrgContext } from "@/lib/auth/session";
import * as leadsRepo from "@/lib/db/repositories/leads";
import { isUuid } from "@/lib/services/errors";
import { handleInboundReply } from "@/lib/services/negotiation";
import { errorResponse } from "../../_lib/respond";

/**
 * Inbound reply (spec 3.5, demo inbox): POST `{ leadId, body, subject? }`.
 * Authorised by `Authorization: Bearer <CRON_SECRET>` (an email-forwarding
 * worker) or a signed-in owner of the lead's workspace. The reply is stored
 * and run through classification and negotiation.
 */
export const maxDuration = 60;

const Body = z.object({
  leadId: z.string(),
  body: z.string().trim().min(1).max(20_000),
  subject: z.string().max(300).optional(),
});

export async function POST(request: Request) {
  const machine = isAuthorizedCron(request);
  const session = machine ? null : await getOrgContext();
  if (!machine && !session) return Response.json({ error: "unauthorized" }, { status: 401 });

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Send { leadId, body }." }, { status: 400 });
  const { leadId, body, subject } = parsed.data;
  if (!isUuid(leadId)) return Response.json({ error: "Lead not found" }, { status: 404 });

  try {
    const lead = await leadsRepo.getByIdUnscoped(leadId);
    if (!lead || (session && lead.orgId !== session.org.id)) {
      return Response.json({ error: "Lead not found" }, { status: 404 });
    }
    const result = await handleInboundReply(lead.orgId, lead.id, body, new Date(), {
      subject,
      actor: machine ? "webhook" : "user",
    });
    return Response.json(result);
  } catch (error) {
    return errorResponse(error, "inbound email");
  }
}
