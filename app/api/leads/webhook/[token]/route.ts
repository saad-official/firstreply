import { after } from "next/server";
import { runIntakeFollowUp } from "@/lib/services/jobs";
import { ingestWebhook } from "@/lib/services/webhooks";
import { errorResponse, headerRecord, readBodyText } from "../../../_lib/respond";

/**
 * Provider webhook (public, spec 3.1): POST /api/leads/webhook/<token>.
 * JSON or form bodies from Typeform, Tally, Webflow, Framer or anything with
 * an email field. 200 `{ leadId }` (also for a merged follow-up and for spam,
 * so providers never retry those); 401 bad token; 400 no email in the
 * payload; 402 plan limit; 429 rate limit. Processing runs after the response.
 */
export const maxDuration = 60;

export async function POST(request: Request, ctx: RouteContext<"/api/leads/webhook/[token]">) {
  const { token } = await ctx.params;
  const text = await readBodyText(request);
  if (text === null) return Response.json({ error: "Payload too large." }, { status: 413 });
  const headers = headerRecord(request);
  const type = headers["content-type"] ?? "";
  let body: unknown = text;
  if (type.includes("application/x-www-form-urlencoded")) body = new URLSearchParams(text);
  try {
    const result = await ingestWebhook(token, body, headers);
    after(() => runIntakeFollowUp(result.lead.orgId, result));
    return Response.json({ leadId: result.lead.id, merged: result.merged, provider: result.provider });
  } catch (error) {
    return errorResponse(error, "lead webhook");
  }
}
