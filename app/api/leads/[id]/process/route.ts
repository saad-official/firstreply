import { getOrgContext } from "@/lib/auth/session";
import { assertUuid } from "@/lib/services/errors";
import { processLead } from "@/lib/services/intake";
import { errorResponse } from "../../../_lib/respond";

/**
 * POST /api/leads/<id>/process: re-run enrichment, scoring and drafting for
 * a lead that has not been replied to yet (unsent drafts are rejected
 * first). Signed-in owners only.
 */
export const maxDuration = 60;

export async function POST(_request: Request, ctx: RouteContext<"/api/leads/[id]/process">) {
  const session = await getOrgContext();
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  try {
    assertUuid(id, "Lead");
    const result = await processLead(session.org.id, id, { force: true, actor: "user" });
    return Response.json(
      result.status === "processed"
        ? { status: result.status, action: result.action, messageId: result.messageId, autoSent: result.autoSent }
        : { status: result.status, reason: result.reason },
    );
  } catch (error) {
    return errorResponse(error, "re-process lead");
  }
}
