"use client";

import { useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import { saveFormFieldsAction } from "@/app/(app)/settings/actions";
import { FormMessage } from "@/components/app/form-message";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { FormField, FormFieldType } from "@/lib/db/types";
import { Field, selectClass } from "./fields";
import { SaveButton } from "./save-button";
import { toastResult } from "./use-toast-action";

/** Built into every hosted form (mirrors BUILT_IN_FIELDS in lib/db/repositories/forms.ts, which is server-only). */
const BUILT_IN = ["name", "email", "company", "message"];
const HONEYPOT = "website_url";

const TYPE_LABEL: Record<FormFieldType, string> = {
  text: "Short text",
  textarea: "Long text",
  email: "Email",
  tel: "Phone",
  url: "Link",
  select: "Dropdown",
};

type Row = { key: string; name: string; label: string; type: FormFieldType; required: boolean; options: string };

function toRow(field: FormField, index: number): Row {
  return {
    key: `${field.name}-${index}`,
    name: field.name,
    label: field.label,
    type: field.type,
    required: Boolean(field.required),
    options: (field.options ?? []).join(", "),
  };
}

/** "Budget range (USD)" -> "budget_range_usd", unique against built-ins and existing rows. */
function keyFromLabel(label: string, taken: Set<string>): string {
  let base = label
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);
  if (!/^[a-z]/.test(base)) base = `field_${base}`.replace(/_+$/, "");
  let name = base;
  for (let n = 2; taken.has(name); n++) name = `${base}_${n}`;
  return name;
}

/**
 * Simple add/remove editor for a form's custom fields (beyond name, email,
 * company and message). Field keys are derived from the label when a field is
 * added and never change afterwards, so stored answers keep their key.
 */
export function FormFieldsEditor({ formId, fields }: { formId: string; fields: FormField[] }) {
  const [rows, setRows] = useState<Row[]>(() => fields.map(toRow));
  const [newLabel, setNewLabel] = useState("");
  const [newType, setNewType] = useState<FormFieldType>("text");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const base = `ff-${formId}`;

  function update(key: string, patch: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function addField() {
    const label = newLabel.trim();
    if (!label) {
      setError("Type a label for the new field first.");
      return;
    }
    const taken = new Set([...BUILT_IN, HONEYPOT, ...rows.map((r) => r.name)]);
    const name = keyFromLabel(label, taken);
    setRows((prev) => [...prev, { key: `${name}-${Date.now()}`, name, label, type: newType, required: false, options: "" }]);
    setNewLabel("");
    setNewType("text");
    setError(null);
  }

  function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const payload: FormField[] = rows.map((r) => ({
      name: r.name,
      label: r.label.trim(),
      type: r.type,
      ...(r.required ? { required: true } : {}),
      ...(r.type === "select"
        ? {
            options: r.options
              .split(",")
              .map((o) => o.trim())
              .filter(Boolean),
          }
        : {}),
    }));
    startTransition(async () => {
      const result = await saveFormFieldsAction(formId, payload);
      toastResult(result);
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <form onSubmit={save} className="grid gap-4">
      <p className="text-sm text-muted-foreground">
        Every form already asks for <span className="font-medium text-foreground">name, email, company</span> and{" "}
        <span className="font-medium text-foreground">message</span>. Add up to 12 extra questions; answers are stored
        on the lead.
      </p>

      {rows.length > 0 ? (
        <ul className="grid gap-3">
          {rows.map((row, index) => {
            const id = `${base}-${index}`;
            return (
              <li key={row.key} className="grid gap-3 rounded-xl bg-muted/50 p-3 ring-1 ring-foreground/5">
                <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
                  <Field id={`${id}-label`} label="Label">
                    <Input
                      id={`${id}-label`}
                      value={row.label}
                      maxLength={80}
                      required
                      onChange={(e) => update(row.key, { label: e.target.value })}
                    />
                  </Field>
                  <Field id={`${id}-type`} label="Type">
                    <select
                      id={`${id}-type`}
                      value={row.type}
                      onChange={(e) => update(row.key, { type: e.target.value as FormFieldType })}
                      className={selectClass}
                    >
                      {Object.entries(TYPE_LABEL).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                {row.type === "select" ? (
                  <Field id={`${id}-options`} label="Options, separated by commas">
                    <Input
                      id={`${id}-options`}
                      value={row.options}
                      onChange={(e) => update(row.key, { options: e.target.value })}
                      placeholder="Under $5k, $5k to $15k, Over $15k"
                    />
                  </Field>
                ) : null}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <input
                      id={`${id}-required`}
                      type="checkbox"
                      checked={row.required}
                      onChange={(e) => update(row.key, { required: e.target.checked })}
                      className="size-4 rounded accent-coral-ink outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                    />
                    <Label htmlFor={`${id}-required`} className="font-normal">
                      Required
                    </Label>
                    <span className="font-mono text-xs break-all text-muted-foreground">key: {row.name}</span>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setRows((prev) => prev.filter((r) => r.key !== row.key))}
                    aria-label={`Remove field ${row.label || row.name}`}
                  >
                    <Trash2 aria-hidden />
                    Remove
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}

      {rows.length < 12 ? (
        <div className="grid gap-3 rounded-xl border border-dashed p-3 sm:grid-cols-[1fr_10rem_auto] sm:items-end">
          <Field id={`${base}-new-label`} label="New field label">
            <Input
              id={`${base}-new-label`}
              value={newLabel}
              maxLength={80}
              onChange={(e) => setNewLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addField();
                }
              }}
              placeholder="Budget range"
            />
          </Field>
          <Field id={`${base}-new-type`} label="Type">
            <select
              id={`${base}-new-type`}
              value={newType}
              onChange={(e) => setNewType(e.target.value as FormFieldType)}
              className={selectClass}
            >
              {Object.entries(TYPE_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Button type="button" variant="outline" size="lg" onClick={addField}>
            <Plus aria-hidden />
            Add field
          </Button>
        </div>
      ) : null}

      <FormMessage error={error} />
      <div>
        <SaveButton pending={pending} pendingLabel="Saving" variant="secondary">
          Save fields
        </SaveButton>
      </div>
    </form>
  );
}
