import "server-only";
import { z } from "zod";
import { isNotFoundError, isServiceError, isSlotUnavailableError } from "@/lib/services/errors";
import { isPlanLimitError } from "@/lib/services/plan-limits";

/**
 * One mapping from service errors to what a Server Action returns to the UI
 * (`{ ok: false, error, upgradeUrl? }`). Plan limits, not-found, slot and
 * service errors carry messages that are safe to show; anything else is
 * logged and replaced by a generic message.
 *
 * Never wrap `redirect()` in a try block that calls this: redirect works by
 * throwing, and this would swallow it.
 */
export function actionError(error: unknown, label: string): { ok: false; error: string; upgradeUrl?: string } {
  if (isPlanLimitError(error)) return { ok: false, error: error.message, upgradeUrl: error.upgradeUrl };
  if (isNotFoundError(error)) return { ok: false, error: `${notFoundSubject(error)} was not found. It may have been deleted.` };
  if (isSlotUnavailableError(error)) return { ok: false, error: "That time was just taken. Pick another." };
  if (isServiceError(error)) return { ok: false, error: error.message };
  if (error instanceof Error && error.name === "SlugTakenError") return { ok: false, error: error.message };
  console.error(`[action] ${label} failed`, error instanceof Error ? (error.stack ?? error.message) : error);
  return { ok: false, error: "Something went wrong. Please try again." };
}

function notFoundSubject(error: Error): string {
  const match = error.message.match(/^([A-Z][\w ]*?) not found/);
  return match ? match[1] : "That item";
}

export function formText(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export const uuidSchema = z.uuid({ error: "Unknown item." });
