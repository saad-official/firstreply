import "server-only";
import { isNotFoundError, isServiceError, isSlotUnavailableError } from "@/lib/services/errors";
import { isPlanLimitError } from "@/lib/services/plan-limits";

/**
 * One mapping from service errors to JSON responses for the API routes.
 * Messages of known errors are safe to return; anything else is logged and
 * replaced by a generic 500.
 */
export function errorResponse(error: unknown, label: string): Response {
  if (isServiceError(error)) return Response.json({ error: error.message, code: error.code }, { status: error.status });
  if (isPlanLimitError(error)) {
    return Response.json({ error: error.message, code: error.code, upgradeUrl: error.upgradeUrl }, { status: 402 });
  }
  if (isNotFoundError(error)) return Response.json({ error: error.message }, { status: 404 });
  if (isSlotUnavailableError(error)) return Response.json({ error: error.message, code: "slot_unavailable" }, { status: 409 });
  console.error(`[api] ${label} failed`, error instanceof Error ? (error.stack ?? error.message) : error);
  return Response.json({ error: "Something went wrong." }, { status: 500 });
}

/** Request headers as a plain lower-cased record (for the webhook adapters). */
export function headerRecord(request: Request): Record<string, string> {
  const out: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

/** First hop of x-forwarded-for (Vercel sets it), else x-real-ip. Used only as a rate-limit key. */
export function clientIp(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || null;
  return request.headers.get("x-real-ip");
}

export const MAX_BODY_BYTES = 256 * 1024;

/** Reads the body as text, refusing anything over MAX_BODY_BYTES. */
export async function readBodyText(request: Request): Promise<string | null> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return null;
  const text = await request.text();
  return text.length > MAX_BODY_BYTES ? null : text;
}
