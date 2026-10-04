"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { bookSlot } from "@/lib/services/booking";
import { isNotFoundError, isServiceError, isSlotUnavailableError } from "@/lib/services/errors";
import { checkRateLimit } from "@/lib/services/webhooks";

/**
 * Public booking from /b/<slug> (spec 3.3). The service re-checks the slot
 * against the live free list, so a stale page or a race between two
 * visitors comes back as `slotTaken` instead of a double booking.
 */

export type BookingFieldErrors = Partial<Record<"name" | "email" | "message", string>>;

export type BookingActionState =
  | { status: "idle" }
  | {
      status: "error";
      message: string;
      fieldErrors?: BookingFieldErrors;
      /** The chosen time is gone; the client refreshes the slot list. */
      slotTaken?: boolean;
      startsAt?: string;
      /** What the visitor typed, so the form can show it again. */
      values: { name: string; email: string; message: string };
    }
  | {
      status: "booked";
      startsAt: string;
      endsAt: string;
      icsPath: string;
      orgName: string;
      email: string;
      timezone: string;
    };

/** Per visitor per booking page, per minute. Generous for a person, a wall for a script. */
const BOOKINGS_PER_MINUTE = 6;

const BookingForm = z.object({
  slug: z.string().trim().min(1).max(64),
  startsAt: z.iso.datetime({ offset: true, error: "Pick a time first." }),
  timezone: z.string().trim().max(64).optional(),
  name: z.string().trim().min(1, { error: "Enter your name." }).max(120, { error: "Keep your name under 120 characters." }),
  email: z
    .string()
    .trim()
    .max(254, { error: "That email address is too long." })
    .pipe(z.email({ error: "Enter a valid email address." })),
  message: z.string().trim().max(2_000, { error: "Keep the note under 2,000 characters." }).optional(),
});

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
}

async function visitorKey(): Promise<string> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || h.get("x-real-ip") || "unknown";
}

export async function bookSlotAction(_prev: BookingActionState, formData: FormData): Promise<BookingActionState> {
  const raw = {
    slug: text(formData, "slug"),
    startsAt: text(formData, "startsAt"),
    timezone: text(formData, "timezone") || undefined,
    name: text(formData, "name"),
    email: text(formData, "email"),
    message: text(formData, "message") || undefined,
  };
  const values = { name: raw.name, email: raw.email, message: raw.message ?? "" };

  const parsed = BookingForm.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: BookingFieldErrors = {};
    let message = "Check the highlighted fields.";
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if ((key === "name" || key === "email" || key === "message") && !fieldErrors[key]) fieldErrors[key] = issue.message;
      else if (key === "startsAt") message = issue.message;
      else if (key === "slug" || key === "timezone") message = "This booking page link looks wrong. Reload and try again.";
    }
    return { status: "error", message, fieldErrors, startsAt: raw.startsAt, values };
  }
  const input = parsed.data;

  try {
    checkRateLimit(`book:${input.slug.toLowerCase()}:${await visitorKey()}`, BOOKINGS_PER_MINUTE);
    const booked = await bookSlot(input.slug, {
      startsAt: input.startsAt,
      name: input.name,
      email: input.email,
      timezone: input.timezone,
      message: input.message,
    });
    return {
      status: "booked",
      startsAt: booked.startsAt,
      endsAt: booked.endsAt,
      icsPath: booked.icsPath,
      orgName: booked.orgName,
      email: input.email.toLowerCase(),
      timezone: input.timezone ?? "UTC",
    };
  } catch (error) {
    if (isSlotUnavailableError(error)) {
      return {
        status: "error",
        message: "That time was just taken. Pick another.",
        slotTaken: true,
        startsAt: input.startsAt,
        values,
      };
    }
    if (isNotFoundError(error)) {
      return { status: "error", message: "This booking page is no longer available.", startsAt: input.startsAt, values };
    }
    if (isServiceError(error)) {
      return {
        status: "error",
        message: error.code === "rate_limited" ? "Too many tries. Wait a minute and book again." : error.message,
        startsAt: input.startsAt,
        values,
      };
    }
    console.error("[booking] bookSlot failed", error instanceof Error ? error.message : error);
    return {
      status: "error",
      message: "We couldn't book that time. Try again in a moment.",
      startsAt: input.startsAt,
      values,
    };
  }
}
