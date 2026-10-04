import { after } from "next/server";
import { isNotFoundError, isServiceError } from "@/lib/services/errors";
import { runIntakeFollowUp } from "@/lib/services/jobs";
import { isPlanLimitError } from "@/lib/services/plan-limits";
import { ingestHostedForm } from "@/lib/services/webhooks";
import { clientIp, errorResponse, headerRecord, readBodyText } from "../_lib/respond";

/**
 * Hosted form submit (public): POST /api/leads from /f/<slug> or an embed.
 * Accepts form-urlencoded / multipart (browser form post) or JSON. Field
 * names: name, email, company, message, leadTimezone, custom.<field>, the
 * form's honeypot field, and formSlug (or ?form=<slug>).
 *
 * Browser posts get a 303 back to the form's thank-you state (or the error
 * state); JSON callers get JSON. The lead is processed after the response
 * (Next `after`), so the visitor never waits on the model.
 */
export const maxDuration = 60;

const KNOWN = new Set(["name", "email", "company", "message", "leadTimezone", "timezone", "formSlug", "embed"]);

function toPayload(entries: Iterable<[string, unknown]>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const custom: Record<string, string> = {};
  for (const [key, raw] of entries) {
    if (typeof raw !== "string" && typeof raw !== "number" && typeof raw !== "boolean") continue;
    const value = String(raw).slice(0, 10_000);
    if (key.startsWith("custom.")) custom[key.slice(7, 47)] = value;
    else if (KNOWN.has(key) || !(key in out)) out[key] = value;
  }
  if (Object.keys(custom).length > 0) out.customFields = custom;
  return out;
}

function wantsJson(request: Request): boolean {
  const type = request.headers.get("content-type") ?? "";
  const accept = request.headers.get("accept") ?? "";
  return type.includes("application/json") || (accept.includes("application/json") && !accept.includes("text/html"));
}

function redirectTo(request: Request, path: string): Response {
  return Response.redirect(new URL(path, request.url), 303);
}

export async function POST(request: Request) {
  const json = wantsJson(request);
  const url = new URL(request.url);
  let payload: Record<string, unknown>;
  try {
    const type = request.headers.get("content-type") ?? "";
    if (type.includes("application/json")) {
      const text = await readBodyText(request);
      if (text === null) return Response.json({ error: "Payload too large." }, { status: 413 });
      const parsed: unknown = JSON.parse(text || "{}");
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
      const flat = Object.entries(parsed as Record<string, unknown>);
      payload = toPayload(flat);
      const nested = (parsed as Record<string, unknown>).customFields;
      if (nested && typeof nested === "object") {
        payload.customFields = { ...(payload.customFields as object), ...(nested as Record<string, unknown>) };
      }
    } else {
      payload = toPayload((await request.formData()).entries());
    }
  } catch {
    return json ? Response.json({ error: "Could not read the form." }, { status: 400 }) : redirectTo(request, "/");
  }

  const slug = String(payload.formSlug ?? url.searchParams.get("form") ?? "").trim().toLowerCase();
  const formPath = `/f/${encodeURIComponent(slug)}`;
  // Keep the iframe embed's compact layout across the redirect.
  const embed = payload.embed === "1" ? "&embed=1" : "";
  delete payload.embed;
  try {
    const result = await ingestHostedForm(slug, payload, headerRecord(request), { ip: clientIp(request) });
    after(() => runIntakeFollowUp(result.form.orgId, result));
    return json ? Response.json({ ok: true }) : redirectTo(request, `${formPath}?sent=1${embed}`);
  } catch (error) {
    if (json) {
      if (isPlanLimitError(error)) {
        return Response.json({ error: "This form is not accepting messages right now." }, { status: 402 });
      }
      return errorResponse(error, "hosted form");
    }
    if (isNotFoundError(error)) return redirectTo(request, "/");
    const code = isServiceError(error)
      ? error.code === "rate_limited"
        ? "rate"
        : "invalid"
      : isPlanLimitError(error)
        ? "closed"
        : "server";
    if (code === "server") console.error("[api] hosted form failed", error instanceof Error ? error.message : error);
    return redirectTo(request, `${formPath}?error=${code}${embed}`);
  }
}
