import "server-only";
import * as availabilityRepo from "@/lib/db/repositories/availability";
import * as formsRepo from "@/lib/db/repositories/forms";
import * as organizationsRepo from "@/lib/db/repositories/organizations";
import type { OrganizationSettings } from "@/lib/db/repositories/organizations";
import * as webhookTokensRepo from "@/lib/db/repositories/webhookTokens";
import type {
  AvailabilityRuleInput,
  Blackout,
  Form,
  FormField,
  Organization,
  OrgVoice,
  WebhookToken,
} from "@/lib/db/types";
import { NotFoundError, ServiceError } from "./errors";
import { assertAutonomyAllowed, assertCapacity } from "./plan-limits";
import { audit } from "./shared";

/**
 * Workspace settings (profile, voice, rubric, autonomy, availability,
 * blackouts, hosted forms, webhook tokens). Thin wrappers over the
 * repositories that add plan checks and the audit trail; repository
 * validation errors (plain Error with a user-facing message) are re-thrown
 * as ServiceError so screens can show them.
 */

function asServiceError(error: unknown): never {
  if (error instanceof Error && error.constructor === Error) throw new ServiceError("invalid_input", error.message);
  throw error;
}

export type ProfileUpdate = Omit<OrganizationSettings, "voice"> & { voice?: Partial<OrgVoice> };

export async function updateProfile(org: Organization, userId: string, patch: ProfileUpdate): Promise<Organization> {
  if (patch.autonomy === "auto_high_score") assertAutonomyAllowed(org);
  if (patch.voice) {
    const url = patch.voice.declineResourceUrl?.trim();
    if (url && !/^https?:\/\/\S+$/i.test(url)) {
      throw new ServiceError("invalid_input", "The decline resource must be a full link starting with https://.");
    }
  }
  const voice: OrgVoice | undefined = patch.voice
    ? Object.fromEntries(
        Object.entries({ ...org.voice, ...patch.voice })
          .map(([k, v]) => [k, typeof v === "string" ? v.trim().slice(0, 1_000) : v])
          .filter(([, v]) => v !== undefined && v !== ""),
      )
    : undefined;
  if (patch.rubric !== undefined && patch.rubric.length > 5_000) {
    throw new ServiceError("invalid_input", "Keep the rubric under 5,000 characters.");
  }
  if (patch.offer !== undefined && patch.offer.length > 300) {
    throw new ServiceError("invalid_input", "Keep the offer under 300 characters.");
  }
  let updated: Organization | null;
  try {
    updated = await organizationsRepo.updateSettings(org.id, { ...patch, voice });
  } catch (error) {
    asServiceError(error);
  }
  if (!updated) throw new NotFoundError("Organization");
  await audit({
    orgId: org.id,
    actor: "user",
    type: "settings.updated",
    entityType: "organization",
    entityId: org.id,
    input: { userId, fields: Object.keys(patch) },
  });
  return updated;
}

export async function replaceAvailability(
  orgId: string,
  userId: string,
  rules: readonly AvailabilityRuleInput[],
): Promise<void> {
  try {
    await availabilityRepo.replaceRules(orgId, rules);
  } catch (error) {
    asServiceError(error);
  }
  await audit({
    orgId,
    actor: "user",
    type: "availability.replaced",
    entityType: "organization",
    entityId: orgId,
    input: { userId, windows: rules.length },
  });
}

export async function addBlackout(orgId: string, userId: string, date: string, reason?: string | null): Promise<Blackout> {
  try {
    const row = await availabilityRepo.addBlackout(orgId, date, reason);
    await audit({ orgId, actor: "user", type: "blackout.added", entityType: "organization", entityId: orgId, input: { userId, date } });
    return row;
  } catch (error) {
    asServiceError(error);
  }
}

export async function removeBlackout(orgId: string, userId: string, blackoutId: string): Promise<void> {
  if (!(await availabilityRepo.removeBlackout(orgId, blackoutId))) throw new NotFoundError("Blackout");
  await audit({ orgId, actor: "user", type: "blackout.removed", entityType: "organization", entityId: orgId, input: { userId } });
}

/* ------------------------------------------------------------------ */
/* Hosted forms                                                        */
/* ------------------------------------------------------------------ */

export async function createForm(
  org: Organization,
  userId: string,
  input: { name?: string; fields?: FormField[] } = {},
): Promise<Form> {
  const active = (await formsRepo.listForOrg(org.id)).filter((f) => f.active).length;
  assertCapacity(org, "forms", active);
  let form: Form;
  try {
    form = await formsRepo.create(org.id, { name: input.name, fields: input.fields, slugBase: org.bookingSlug });
  } catch (error) {
    asServiceError(error);
  }
  await audit({ orgId: org.id, actor: "user", type: "form.created", entityType: "form", entityId: form.id, input: { userId } });
  return form;
}

export async function updateForm(
  org: Organization,
  userId: string,
  formId: string,
  patch: formsRepo.UpdateFormInput,
): Promise<Form> {
  const current = await formsRepo.getById(org.id, formId);
  if (!current) throw new NotFoundError("Form");
  if (patch.active === true && !current.active) {
    const active = (await formsRepo.listForOrg(org.id)).filter((f) => f.active).length;
    assertCapacity(org, "forms", active);
  }
  let updated: Form | null;
  try {
    updated = await formsRepo.update(org.id, formId, patch);
  } catch (error) {
    asServiceError(error);
  }
  if (!updated) throw new NotFoundError("Form");
  await audit({
    orgId: org.id,
    actor: "user",
    type: "form.updated",
    entityType: "form",
    entityId: formId,
    input: { userId, fields: Object.keys(patch) },
  });
  return updated;
}

/* ------------------------------------------------------------------ */
/* Webhook tokens                                                      */
/* ------------------------------------------------------------------ */

export async function createWebhookToken(org: Organization, userId: string, sourceLabel?: string): Promise<WebhookToken> {
  const active = (await webhookTokensRepo.listForOrg(org.id)).filter((t) => !t.revokedAt).length;
  assertCapacity(org, "webhook_tokens", active);
  const token = await webhookTokensRepo.create(org.id, { sourceLabel: sourceLabel?.trim().slice(0, 80) || undefined });
  await audit({
    orgId: org.id,
    actor: "user",
    type: "webhook_token.created",
    entityType: "webhook_token",
    entityId: token.id,
    input: { userId, sourceLabel: token.sourceLabel },
  });
  return token;
}

export async function revokeWebhookToken(orgId: string, userId: string, tokenId: string): Promise<void> {
  if (!(await webhookTokensRepo.revoke(orgId, tokenId))) throw new NotFoundError("Webhook token");
  await audit({
    orgId,
    actor: "user",
    type: "webhook_token.revoked",
    entityType: "webhook_token",
    entityId: tokenId,
    input: { userId },
  });
}

/** Everything the settings screen shows, in one call. */
export async function getSettingsData(orgId: string) {
  const [rules, blackouts, forms, tokens] = await Promise.all([
    availabilityRepo.listRules(orgId),
    availabilityRepo.listBlackouts(orgId),
    formsRepo.listForOrg(orgId),
    webhookTokensRepo.listForOrg(orgId),
  ]);
  return { rules, blackouts, forms, tokens };
}
