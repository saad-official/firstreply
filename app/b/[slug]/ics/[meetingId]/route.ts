import { getMeetingIcs } from "@/lib/services/booking";

/**
 * GET /b/<slug>/ics/<meetingId>: the booked meeting's calendar invite. Public
 * (the lead downloads it from the booking confirmation); the meeting id is a
 * random UUID and must belong to the booking page's workspace.
 */
export async function GET(_request: Request, ctx: RouteContext<"/b/[slug]/ics/[meetingId]">) {
  const { slug, meetingId } = await ctx.params;
  const ics = await getMeetingIcs(slug, meetingId);
  if (!ics) return new Response("Not found", { status: 404 });
  return new Response(ics, {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": 'attachment; filename="firstreply-meeting.ics"',
      "cache-control": "private, no-store",
    },
  });
}
