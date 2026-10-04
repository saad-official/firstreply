import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "../client";
import { forms } from "../schema";
import type { Form, FormField } from "../types";
import { isUniqueViolation, isValidPublicSlug, randomSlugSuffix, SlugTakenError } from "./shared";

const FIELD_NAME = /^[a-z][a-z0-9_]{0,39}$/;
/** Built into every hosted form; custom fields may not reuse these names. */
export const BUILT_IN_FIELDS = ["name", "email", "company", "message"] as const;

function validateFields(fields: readonly FormField[], honeypotField: string): FormField[] {
  const seen = new Set<string>(BUILT_IN_FIELDS);
  for (const field of fields) {
    if (!FIELD_NAME.test(field.name)) throw new Error(`Invalid field name: ${field.name}`);
    if (seen.has(field.name)) throw new Error(`Duplicate field name: ${field.name}`);
    if (field.name === honeypotField) throw new Error("A field cannot share the honeypot's name.");
    if (!field.label?.trim()) throw new Error(`Field ${field.name} needs a label.`);
    seen.add(field.name);
  }
  return [...fields];
}

/** Public hosted-form lookup (/f/<slug>); null for unknown or inactive forms. Not org-scoped. */
export async function getBySlug(slug: string): Promise<Form | null> {
  const value = slug.trim().toLowerCase();
  if (!isValidPublicSlug(value)) return null;
  const db = await getDb();
  const [row] = await db
    .select()
    .from(forms)
    .where(and(eq(forms.slug, value), eq(forms.active, true)))
    .limit(1);
  return row ?? null;
}

export async function getById(orgId: string, formId: string): Promise<Form | null> {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(forms)
    .where(and(eq(forms.id, formId), eq(forms.orgId, orgId)))
    .limit(1);
  return row ?? null;
}

export async function listForOrg(orgId: string): Promise<Form[]> {
  const db = await getDb();
  return db.select().from(forms).where(eq(forms.orgId, orgId)).orderBy(asc(forms.createdAt));
}

export type CreateFormInput = {
  name?: string;
  /** Explicit slug; when omitted one is derived from `slugBase` plus a random suffix. */
  slug?: string;
  /** e.g. the org's booking slug. */
  slugBase?: string;
  fields?: FormField[];
  honeypotField?: string;
};

/** Creates a hosted form. Throws SlugTakenError when an explicit slug is used elsewhere. */
export async function create(orgId: string, input: CreateFormInput = {}): Promise<Form> {
  const honeypotField = input.honeypotField?.trim() || "website_url";
  const fields = validateFields(input.fields ?? [], honeypotField);
  const name = input.name?.trim() || "Contact form";
  const explicit = input.slug?.trim().toLowerCase();
  if (explicit !== undefined && !isValidPublicSlug(explicit)) {
    throw new Error("Form link: use lower-case letters, digits and hyphens (up to 48 characters).");
  }
  const base = (input.slugBase ?? "form").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "form";
  const db = await getDb();
  for (let attempt = 0; ; attempt++) {
    const slug = explicit ?? `${base}-${randomSlugSuffix(6)}`;
    try {
      const [row] = await db.insert(forms).values({ orgId, slug, name, fields, honeypotField }).returning();
      return row;
    } catch (error) {
      if (isUniqueViolation(error, "forms_slug_unique")) {
        if (explicit !== undefined) throw new SlugTakenError(explicit);
        if (attempt < 3) continue;
      }
      throw error;
    }
  }
}

export type UpdateFormInput = {
  name?: string;
  slug?: string;
  fields?: FormField[];
  honeypotField?: string;
  active?: boolean;
};

export async function update(orgId: string, formId: string, patch: UpdateFormInput): Promise<Form | null> {
  const current = await getById(orgId, formId);
  if (!current) return null;
  const values: Partial<typeof forms.$inferInsert> = {};
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) throw new Error("Form name cannot be empty.");
    values.name = name;
  }
  if (patch.slug !== undefined) {
    const slug = patch.slug.trim().toLowerCase();
    if (!isValidPublicSlug(slug)) {
      throw new Error("Form link: use lower-case letters, digits and hyphens (up to 48 characters).");
    }
    values.slug = slug;
  }
  if (patch.honeypotField !== undefined) values.honeypotField = patch.honeypotField.trim() || "website_url";
  if (patch.fields !== undefined || patch.honeypotField !== undefined) {
    values.fields = validateFields(patch.fields ?? current.fields, values.honeypotField ?? current.honeypotField);
  }
  if (patch.active !== undefined) values.active = patch.active;
  if (Object.keys(values).length === 0) return current;
  const db = await getDb();
  try {
    const [row] = await db
      .update(forms)
      .set(values)
      .where(and(eq(forms.id, formId), eq(forms.orgId, orgId)))
      .returning();
    return row ?? null;
  } catch (error) {
    if (values.slug && isUniqueViolation(error, "forms_slug_unique")) throw new SlugTakenError(values.slug);
    throw error;
  }
}
