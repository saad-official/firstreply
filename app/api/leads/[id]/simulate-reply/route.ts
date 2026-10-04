import { z } from "zod";
import { getOrgContext } from "@/lib/auth/session";
import { assertUuid } from "@/lib/services/errors";
import { SIMULATION_SCENARIOS, simulateLeadReply } from "@/lib/services/negotiation";
import { errorResponse } from "../../../_lib/respond";

/**
 * Demo (spec 3.7): POST /api/leads/<id>/simulate-reply `{ scenario }` writes a
 * reply from the lead with the chosen intent and runs it through
 * negotiation. Signed-in owners only.
 */
export const maxDuration = 60;

const Body = z.object({ scenario: z.enum(SIMULATION_SCENARIOS) });

export async function POST(request: Request, ctx: RouteContext<"/api/leads/[id]/simulate-reply">) {
  const session = await getOrgContext();
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Pick a scenario." }, { status: 400 });
  try {
    assertUuid(id, "Lead");
    const result = await simulateLeadReply(session.org.id, id, parsed.data.scenario);
    return Response.json(result);
  } catch (error) {
    return errorResponse(error, "simulate reply");
  }
}
