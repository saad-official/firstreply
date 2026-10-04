"use client";

import { useState, useTransition } from "react";
import { ExternalLink, Loader2, Plus } from "lucide-react";
import { createFormAction, renameFormAction, setFormActiveAction } from "@/app/(app)/settings/actions";
import { FormMessage } from "@/components/app/form-message";
import { Pill } from "@/components/app/pills";
import { SubmitButton } from "@/components/app/submit-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { FormField } from "@/lib/db/types";
import { CopyField } from "./copy-button";
import { Field } from "./fields";
import { FormFieldsEditor } from "./form-fields-editor";
import { SaveButton } from "./save-button";
import { toastResult, useToastAction } from "./use-toast-action";

export type HostedFormItem = { id: string; name: string; slug: string; active: boolean; fields: FormField[] };

export function embedSnippet(appUrl: string, slug: string): string {
  return `<iframe src="${appUrl}/f/${slug}?embed=1" title="Contact form" style="width:100%;min-height:640px;border:0" loading="lazy"></iframe>`;
}

export function HostedForms({
  forms,
  appUrl,
  activeLimit,
}: {
  forms: HostedFormItem[];
  appUrl: string;
  /** Active-form limit for the plan; null = unlimited. */
  activeLimit: number | null;
}) {
  const { state, formAction } = useToastAction(createFormAction);
  const activeCount = forms.filter((f) => f.active).length;

  return (
    <div className="grid gap-5">
      {forms.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-5 text-sm text-muted-foreground">
          No hosted forms yet. Create one to get a link you can share and a snippet you can paste into any site.
        </p>
      ) : (
        <ul className="grid gap-4">
          {forms.map((form) => (
            <li key={form.id}>
              <FormCard form={form} appUrl={appUrl} />
            </li>
          ))}
        </ul>
      )}

      <form action={formAction} className="grid gap-3 rounded-xl border border-dashed p-3 sm:p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm font-medium">Create a form</p>
          <p className="text-xs text-muted-foreground">
            <span className="stopwatch text-foreground">{activeCount}</span>
            {activeLimit === null ? " active, no limit on Pro" : ` of ${activeLimit} active on Free`}
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <Field id="new-form-name" label="Form name (optional)">
            <Input id="new-form-name" name="name" maxLength={80} placeholder="Contact form" />
          </Field>
          <SubmitButton pendingLabel="Creating" size="lg">
            <Plus aria-hidden />
            Create form
          </SubmitButton>
        </div>
        <FormMessage error={state.ok ? null : state.error} upgradeUrl={state.upgradeUrl} />
      </form>
    </div>
  );
}

function FormCard({ form, appUrl }: { form: HostedFormItem; appUrl: string }) {
  const rename = useToastAction(renameFormAction);
  const [toggling, startToggle] = useTransition();
  const [toggleError, setToggleError] = useState<{ error: string; upgradeUrl?: string } | null>(null);
  const link = `${appUrl}/f/${form.slug}`;
  const nameId = `form-${form.id}-name`;

  function toggle() {
    setToggleError(null);
    startToggle(async () => {
      const result = await setFormActiveAction(form.id, !form.active);
      toastResult(result);
      if (!result.ok) setToggleError({ error: result.error, upgradeUrl: result.upgradeUrl });
    });
  }

  return (
    <article
      aria-labelledby={`${nameId}-title`}
      className="grid gap-4 rounded-2xl bg-background/60 p-4 ring-1 ring-foreground/10 sm:p-5"
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h3 id={`${nameId}-title`} className="min-w-0 font-heading text-lg break-words">
            {form.name}
          </h3>
          {form.active ? (
            <Pill tone="sea">
              <span aria-hidden className="size-1.5 rounded-full bg-current" />
              Live
            </Pill>
          ) : (
            <Pill tone="quiet">Inactive</Pill>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {form.active ? (
            <Button asChild variant="ghost" size="sm">
              <a href={link} target="_blank" rel="noopener noreferrer">
                <ExternalLink aria-hidden />
                Open<span className="sr-only"> {form.name} in a new tab</span>
              </a>
            </Button>
          ) : null}
          <Button type="button" variant="outline" size="sm" onClick={toggle} disabled={toggling}>
            {toggling ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {form.active ? "Deactivate" : "Activate"}
            <span className="sr-only"> {form.name}</span>
          </Button>
        </div>
      </header>

      <FormMessage error={toggleError?.error} upgradeUrl={toggleError?.upgradeUrl} />

      <div className="grid gap-1.5">
        <p className="text-xs font-medium text-muted-foreground">Hosted link</p>
        <CopyField value={link} label={`Copy link to ${form.name}`} />
      </div>
      <div className="grid gap-1.5">
        <p className="text-xs font-medium text-muted-foreground">Embed snippet (paste into your site&apos;s HTML)</p>
        <CopyField value={embedSnippet(appUrl, form.slug)} label={`Copy embed snippet for ${form.name}`} multiline />
      </div>
      {!form.active ? (
        <p className="text-xs text-muted-foreground">
          While inactive, the link and embed show a not-found page and no leads arrive from this form.
        </p>
      ) : null}

      <details className="group rounded-xl ring-1 ring-foreground/10 open:bg-card">
        <summary className="cursor-pointer rounded-xl px-3 py-2.5 text-sm font-medium outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/50">
          Edit name and fields
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            {form.fields.length === 0
              ? "built-in fields only"
              : `${form.fields.length} custom field${form.fields.length === 1 ? "" : "s"}`}
          </span>
        </summary>
        <div className="grid gap-6 border-t px-3 py-4">
          <form onSubmit={rename.onSubmit} className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <input type="hidden" name="formId" value={form.id} />
            <Field id={nameId} label="Form name">
              <Input id={nameId} name="name" defaultValue={form.name} required maxLength={80} />
            </Field>
            <SaveButton pending={rename.pending} pendingLabel="Saving" variant="outline">
              Rename
            </SaveButton>
            <FormMessage
              className="sm:col-span-2"
              error={rename.state.ok ? null : rename.state.error}
              upgradeUrl={rename.state.upgradeUrl}
            />
          </form>
          <FormFieldsEditor formId={form.id} fields={form.fields} />
        </div>
      </details>
    </article>
  );
}
