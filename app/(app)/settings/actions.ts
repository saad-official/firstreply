"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult, FormActionState } from "@/components/app/action-result";
import { requireOrgContext, type OrgContext } from "@/lib/auth/session";
import type { AvailabilityRuleInput, FormField } from "@/lib/db/types";
import {
  addBlackout,
  createForm,
  createWebhookToken,
  removeBlackout,
  replaceAvailability,
  revokeWebhookToken,
  updateForm,
  updateProfile,
} from "@/lib/services/settings";
import { timeToMinutes } from "@/lib/format";
import { actionError, formText, uuidSchema } from "../_lib/action-errors";

/*
 * Settings Server Actions. Each one: requireOrgContext(), owner check,
 * zod-validate the input, call lib/services/settings, revalidate, and
 * return a message the UI can show. Service errors (plan limits, slug taken,
 * repository validation) go through actionError so the UI gets a safe
 * message and, for plan limits, `upgradeUrl`.
 */

const OWNER_ONLY = "Only the workspace owner can change settings.";

async function ownerContext(): Promise<OrgContext | null> {
  const ctx = await requireOrgContext();
  return ctx.role === "owner" ? ctx : null;
}

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Check the form and try again.";
}

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function intField(label: string, min: number, max: number) {
  return z.coerce
    .number({ error: `${label} must be a number.` })
    .int({ error: `${label} must be a whole number.` })
    .min(min, { error: `${label} must be between ${min} and ${max}.` })
    .max(max, { error: `${label} must be between ${min} and ${max}.` });
}

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/;

/* ------------------------------------------------------------------ */
/* Profile & time zone                                                 */
/* ------------------------------------------------------------------ */

const profileSchema = z.object({
  name: z
    .string()
    .min(1, { error: "Enter your business name." })
    .max(120, { error: "Keep the business name under 120 characters." }),
  timezone: z.string().refine(isTimeZone, { error: "Choose a time zone from the list." }),
  bookingSlug: z
    .string()
    .transform((v) => v.toLowerCase())
    .refine((v) => SLUG.test(v) && !v.includes("--"), {
      error: "Booking link: use lower-case letters, digits and single hyphens (up to 48 characters).",
    }),
  meetingLengthMinutes: z.enum(["15", "30", "45"], { error: "Meeting length must be 15, 30 or 45 minutes." }).transform(Number),
  bufferMinutes: intField("Buffer", 0, 240),
  minNoticeHours: intField("Minimum notice", 0, 336),
  horizonBusinessDays: intField("Booking horizon", 1, 60),
});

export async function saveProfileAction(_prev: FormActionState, formData: FormData): Promise<FormActionState> {
  const ctx = await ownerContext();
  if (!ctx) return { ok: false, error: OWNER_ONLY };
  const parsed = profileSchema.safeParse({
    name: formText(formData, "name"),
    timezone: formText(formData, "timezone"),
    bookingSlug: formText(formData, "bookingSlug"),
    meetingLengthMinutes: formText(formData, "meetingLengthMinutes"),
    bufferMinutes: formText(formData, "bufferMinutes"),
    minNoticeHours: formText(formData, "minNoticeHours"),
    horizonBusinessDays: formText(formData, "horizonBusinessDays"),
  });
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  try {
    await updateProfile(ctx.org, ctx.user.id, parsed.data);
  } catch (error) {
    return actionError(error, "save profile");
  }
  // The business name shows in the app shell; slots and the booking page depend on the rest.
  revalidatePath("/", "layout");
  return { ok: true, message: "Profile saved." };
}

/* ------------------------------------------------------------------ */
/* Availability                                                        */
/* ------------------------------------------------------------------ */

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

/** "570-1020,1080-1200": extra windows kept from the database when a day has more than one. */
function parseExtraWindows(value: string, weekday: number): AvailabilityRuleInput[] | null {
  if (!value) return [];
  const out: AvailabilityRuleInput[] = [];
  for (const part of value.split(",")) {
    const m = /^(\d{1,4})-(\d{1,4})$/.exec(part.trim());
    if (!m) return null;
    out.push({ weekday, startMinute: Number(m[1]), endMinute: Number(m[2]) });
  }
  return out;
}

export async function saveAvailabilityAction(_prev: FormActionState, formData: FormData): Promise<FormActionState> {
  const ctx = await ownerContext();
  if (!ctx) return { ok: false, error: OWNER_ONLY };
  const rules: AvailabilityRuleInput[] = [];
  for (let weekday = 0; weekday <= 6; weekday++) {
    if (formData.get(`day-${weekday}-on`) !== "on") continue;
    const start = timeToMinutes(formText(formData, `day-${weekday}-start`));
    const end = timeToMinutes(formText(formData, `day-${weekday}-end`));
    const dayName = WEEKDAY_NAMES[weekday];
    if (start === null || end === null) return { ok: false, error: `${dayName}: enter a start and end time.` };
    if (start >= end) return { ok: false, error: `${dayName}: the start time must be before the end time.` };
    rules.push({ weekday, startMinute: start, endMinute: end });
    const extra = parseExtraWindows(formText(formData, `day-${weekday}-extra`), weekday);
    if (extra === null) return { ok: false, error: `${dayName}: reload the page and try again.` };
    rules.push(...extra);
  }
  try {
    await replaceAvailability(ctx.org.id, ctx.user.id, rules);
  } catch (error) {
    return actionError(error, "save availability");
  }
  revalidatePath("/settings");
  return {
    ok: true,
    message: rules.length === 0 ? "Availability cleared. No slots will be offered." : "Availability saved.",
  };
}

/* ------------------------------------------------------------------ */
/* Blackout dates                                                      */
/* ------------------------------------------------------------------ */

const blackoutSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: "Pick a date." }),
  reason: z.string().max(200, { error: "Keep the reason under 200 characters." }),
});

export async function addBlackoutAction(_prev: FormActionState, formData: FormData): Promise<FormActionState> {
  const ctx = await ownerContext();
  if (!ctx) return { ok: false, error: OWNER_ONLY };
  const parsed = blackoutSchema.safeParse({ date: formText(formData, "date"), reason: formText(formData, "reason") });
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  try {
    await addBlackout(ctx.org.id, ctx.user.id, parsed.data.date, parsed.data.reason || null);
  } catch (error) {
    return actionError(error, "add blackout");
  }
  revalidatePath("/settings");
  return { ok: true, message: "Blackout date added." };
}

export async function removeBlackoutAction(blackoutId: string): Promise<ActionResult> {
  const ctx = await ownerContext();
  if (!ctx) return { ok: false, error: OWNER_ONLY };
  const id = uuidSchema.safeParse(blackoutId);
  if (!id.success) return { ok: false, error: firstIssue(id.error) };
  try {
    await removeBlackout(ctx.org.id, ctx.user.id, id.data);
  } catch (error) {
    return actionError(error, "remove blackout");
  }
  revalidatePath("/settings");
  return { ok: true, message: "Blackout date removed." };
}

/* ------------------------------------------------------------------ */
/* Rubric & offer                                                      */
/* ------------------------------------------------------------------ */

const rubricSchema = z.object({
  rubric: z.string().max(5_000, { error: "Keep the rubric under 5,000 characters." }),
  offer: z.string().max(300, { error: "Keep the offer under 300 characters." }),
});

export async function saveRubricAction(_prev: FormActionState, formData: FormData): Promise<FormActionState> {
  const ctx = await ownerContext();
  if (!ctx) return { ok: false, error: OWNER_ONLY };
  const parsed = rubricSchema.safeParse({ rubric: formText(formData, "rubric"), offer: formText(formData, "offer") });
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  try {
    await updateProfile(ctx.org, ctx.user.id, parsed.data);
  } catch (error) {
    return actionError(error, "save rubric");
  }
  revalidatePath("/settings");
  return { ok: true, message: "Rubric and offer saved. New leads are scored against it." };
}

/* ------------------------------------------------------------------ */
/* Voice & signature                                                   */
/* ------------------------------------------------------------------ */

const voiceSchema = z.object({
  tone: z.string().max(200, { error: "Keep the tone under 200 characters." }),
  senderName: z.string().max(80, { error: "Keep the sender name under 80 characters." }),
  signOff: z.string().max(500, { error: "Keep the sign-off under 500 characters." }),
  notes: z.string().max(1_000, { error: "Keep the notes under 1,000 characters." }),
  declineResourceUrl: z.union([
    z.literal(""),
    z.url({ protocol: /^https?$/, error: "The decline resource must be a full link starting with https://." }),
  ]),
});

export async function saveVoiceAction(_prev: FormActionState, formData: FormData): Promise<FormActionState> {
  const ctx = await ownerContext();
  if (!ctx) return { ok: false, error: OWNER_ONLY };
  // The sign-off keeps its line breaks; formText trims only the ends.
  const parsed = voiceSchema.safeParse({
    tone: formText(formData, "tone"),
    senderName: formText(formData, "senderName"),
    signOff: formText(formData, "signOff").replace(/\r\n/g, "\n"),
    notes: formText(formData, "notes"),
    declineResourceUrl: formText(formData, "declineResourceUrl"),
  });
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  try {
    // Empty strings clear a field (the service drops them from the stored voice).
    await updateProfile(ctx.org, ctx.user.id, { voice: parsed.data });
  } catch (error) {
    return actionError(error, "save voice");
  }
  revalidatePath("/settings");
  return { ok: true, message: "Voice and signature saved." };
}

/* ------------------------------------------------------------------ */
/* Autonomy                                                            */
/* ------------------------------------------------------------------ */

export async function setAutonomyAction(enabled: boolean): Promise<ActionResult> {
  const ctx = await ownerContext();
  if (!ctx) return { ok: false, error: OWNER_ONLY };
  const parsed = z.boolean().safeParse(enabled);
  if (!parsed.success) return { ok: false, error: "Unknown setting." };
  try {
    await updateProfile(ctx.org, ctx.user.id, { autonomy: parsed.data ? "auto_high_score" : "manual" });
  } catch (error) {
    return actionError(error, "set autonomy");
  }
  revalidatePath("/settings");
  revalidatePath("/dashboard");
  return {
    ok: true,
    message: parsed.data
      ? "Auto-reply is on for high-fit leads. Everything else still waits for you."
      : "Auto-reply is off. Every reply waits for your approval.",
  };
}

/* ------------------------------------------------------------------ */
/* Hosted forms                                                        */
/* ------------------------------------------------------------------ */

const formNameSchema = z
  .string()
  .min(1, { error: "Give the form a name." })
  .max(80, { error: "Keep the form name under 80 characters." });

export async function createFormAction(_prev: FormActionState, formData: FormData): Promise<FormActionState> {
  const ctx = await ownerContext();
  if (!ctx) return { ok: false, error: OWNER_ONLY };
  const name = formText(formData, "name");
  const parsed = formNameSchema.optional().safeParse(name || undefined);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  try {
    await createForm(ctx.org, ctx.user.id, { name: parsed.data });
  } catch (error) {
    return actionError(error, "create form");
  }
  revalidatePath("/settings");
  return { ok: true, message: "Form created. Copy its link or embed snippet below." };
}

export async function renameFormAction(_prev: FormActionState, formData: FormData): Promise<FormActionState> {
  const ctx = await ownerContext();
  if (!ctx) return { ok: false, error: OWNER_ONLY };
  const parsed = z
    .object({ formId: uuidSchema, name: formNameSchema })
    .safeParse({ formId: formText(formData, "formId"), name: formText(formData, "name") });
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  try {
    await updateForm(ctx.org, ctx.user.id, parsed.data.formId, { name: parsed.data.name });
  } catch (error) {
    return actionError(error, "rename form");
  }
  revalidatePath("/settings");
  return { ok: true, message: "Form renamed." };
}

export async function setFormActiveAction(formId: string, active: boolean): Promise<ActionResult> {
  const ctx = await ownerContext();
  if (!ctx) return { ok: false, error: OWNER_ONLY };
  const parsed = z.object({ formId: uuidSchema, active: z.boolean() }).safeParse({ formId, active });
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  try {
    await updateForm(ctx.org, ctx.user.id, parsed.data.formId, { active: parsed.data.active });
  } catch (error) {
    return actionError(error, "toggle form");
  }
  revalidatePath("/settings");
  revalidatePath("/billing");
  return {
    ok: true,
    message: parsed.data.active ? "Form is live again." : "Form deactivated. Its link now shows a not-found page.",
  };
}

const fieldSchema = z
  .object({
    name: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/, {
      error: "Field keys use lower-case letters, digits and underscores, starting with a letter.",
    }),
    label: z
      .string()
      .trim()
      .min(1, { error: "Every field needs a label." })
      .max(80, { error: "Keep field labels under 80 characters." }),
    type: z.enum(["text", "email", "textarea", "tel", "url", "select"], { error: "Unknown field type." }),
    required: z.boolean().optional(),
    options: z
      .array(z.string().trim().min(1).max(80))
      .max(20, { error: "Up to 20 options per select field." })
      .optional(),
  })
  .refine((f) => f.type !== "select" || (f.options && f.options.length > 0), {
    error: "A select field needs at least one option.",
  });

const fieldsSchema = z.array(fieldSchema).max(12, { error: "Up to 12 custom fields per form." });

export async function saveFormFieldsAction(formId: string, fields: FormField[]): Promise<ActionResult> {
  const ctx = await ownerContext();
  if (!ctx) return { ok: false, error: OWNER_ONLY };
  const id = uuidSchema.safeParse(formId);
  if (!id.success) return { ok: false, error: firstIssue(id.error) };
  const parsed = fieldsSchema.safeParse(fields);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const clean: FormField[] = parsed.data.map((f) => ({
    name: f.name,
    label: f.label,
    type: f.type,
    ...(f.required ? { required: true } : {}),
    ...(f.type === "select" ? { options: f.options } : {}),
  }));
  try {
    await updateForm(ctx.org, ctx.user.id, id.data, { fields: clean });
  } catch (error) {
    return actionError(error, "save form fields");
  }
  revalidatePath("/settings");
  return { ok: true, message: clean.length === 0 ? "Custom fields removed." : "Custom fields saved." };
}

/* ------------------------------------------------------------------ */
/* Webhook tokens                                                      */
/* ------------------------------------------------------------------ */

export async function createTokenAction(_prev: FormActionState, formData: FormData): Promise<FormActionState> {
  const ctx = await ownerContext();
  if (!ctx) return { ok: false, error: OWNER_ONLY };
  const parsed = z
    .string()
    .max(80, { error: "Keep the label under 80 characters." })
    .safeParse(formText(formData, "label"));
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  try {
    await createWebhookToken(ctx.org, ctx.user.id, parsed.data || undefined);
  } catch (error) {
    return actionError(error, "create webhook token");
  }
  revalidatePath("/settings");
  revalidatePath("/billing");
  return { ok: true, message: "Webhook endpoint created. Paste it into your form tool." };
}

export async function revokeTokenAction(tokenId: string): Promise<ActionResult> {
  const ctx = await ownerContext();
  if (!ctx) return { ok: false, error: OWNER_ONLY };
  const id = uuidSchema.safeParse(tokenId);
  if (!id.success) return { ok: false, error: firstIssue(id.error) };
  try {
    await revokeWebhookToken(ctx.org.id, ctx.user.id, id.data);
  } catch (error) {
    return actionError(error, "revoke webhook token");
  }
  revalidatePath("/settings");
  revalidatePath("/billing");
  return { ok: true, message: "Token revoked. Submissions to that endpoint are now refused." };
}
