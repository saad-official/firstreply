import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { Pill } from "@/components/marketing/mocks/parts";
import { textLink } from "@/components/marketing/site";
import { Dot } from "@/components/marketing/wordmark";
import { BrowserTimeZoneInput } from "@/components/public/browser-timezone";
import {
  FieldRow,
  FormAlert,
  SelectFrame,
  inputClass,
  selectClass,
  textareaClass,
} from "@/components/public/fields";
import { ElapsedClock, FormDraftKeeper, SendButton } from "@/components/public/hosted-form-client";
import { PublicCard, PublicShell } from "@/components/public/public-shell";
import * as formsRepo from "@/lib/db/repositories/forms";
import * as organizationsRepo from "@/lib/db/repositories/organizations";
import type { FormField } from "@/lib/db/types";
import { cn } from "@/lib/utils";

/**
 * Hosted lead form /f/<slug> (spec 3.1). A plain form post to /api/leads, so
 * it works without JavaScript; the route redirects back here with ?sent=1 or
 * ?error=<code>. ?embed=1 (or being loaded inside an iframe) drops the page
 * chrome for the embed snippet.
 */

const loadForm = cache(async (slug: string) => {
  const form = await formsRepo.getBySlug(slug);
  if (!form) return null;
  const org = await organizationsRepo.getById(form.orgId);
  if (!org) return null;
  return { form, orgName: org.name };
});

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

const ERRORS: Record<string, { title: string; body: string }> = {
  invalid: { title: "That didn't go through", body: "Check your email address and try again." },
  rate: { title: "Too many messages", body: "Too many messages from here in a short time; wait a minute and send again." },
  closed: { title: "Form closed", body: "This form is not accepting messages right now." },
  server: { title: "Something went wrong", body: "Your message wasn't sent. Try again in a moment." },
};

const FORM_ID = "lead-form";
const ALERT_ID = "lead-form-alert";

export async function generateMetadata({ params }: PageProps<"/f/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const data = await loadForm(slug);
  return {
    title: data ? `Contact ${data.orgName}` : "Form not found",
    robots: { index: false, follow: false },
  };
}

export default async function HostedFormPage({ params, searchParams }: PageProps<"/f/[slug]">) {
  const { slug } = await params;
  const query = await searchParams;
  const data = await loadForm(slug);
  if (!data) notFound();
  const { form, orgName } = data;

  // The lead route redirects to /f/<slug>?sent=1 without ?embed=1, so also
  // treat a document loaded into an iframe as the embed.
  const requestHeaders = await headers();
  const embed = first(query.embed) === "1" || requestHeaders.get("sec-fetch-dest") === "iframe";
  const sent = first(query.sent) === "1";
  const errorCode = first(query.error);
  const error = !sent && errorCode ? (ERRORS[errorCode] ?? ERRORS.server) : null;
  const selfHref = `/f/${encodeURIComponent(form.slug)}${embed ? "?embed=1" : ""}`;

  return (
    <PublicShell embed={embed}>
      {sent ? (
        <SentPanel orgName={orgName} againHref={selfHref} compact={embed} />
      ) : (
        <PublicCard className={cn(embed && "rounded-2xl p-4 shadow-none sm:p-5")}>
          <header>
            {embed ? null : (
              <Pill tone="quiet">
                <Dot />
                Replies in about a minute
              </Pill>
            )}
            <p className={cn("text-sm font-semibold text-foreground/70", embed ? null : "mt-5")}>{form.name}</p>
            <h1
              className={cn(
                "mt-1 leading-[1.1] text-balance break-words",
                embed ? "text-2xl" : "text-[1.75rem] sm:text-4xl",
              )}
            >
              Get in touch with {orgName}
            </h1>
            <p className="mt-3 text-[0.9375rem] leading-relaxed text-foreground/75">
              Tell them what you need. You&rsquo;ll get a personal reply by email, with times to talk if it&rsquo;s a fit.
            </p>
          </header>

          <form
            id={FORM_ID}
            method="post"
            action="/api/leads"
            className={cn("relative grid gap-5", embed ? "mt-5" : "mt-7")}
          >
            {error ? (
              <FormAlert id={ALERT_ID} title={error.title}>
                {error.body}
              </FormAlert>
            ) : null}

            <div className="grid gap-5 sm:grid-cols-2">
              <FieldRow id="lead-name" label="Your name">
                <input
                  id="lead-name"
                  name="name"
                  type="text"
                  autoComplete="name"
                  maxLength={120}
                  className={inputClass}
                />
              </FieldRow>
              <FieldRow id="lead-email" label="Email" required hint="Where the reply goes.">
                <input
                  id="lead-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                  required
                  maxLength={254}
                  aria-describedby="lead-email-hint"
                  aria-invalid={errorCode === "invalid" && !sent ? true : undefined}
                  className={inputClass}
                />
              </FieldRow>
            </div>

            <FieldRow id="lead-company" label="Company">
              <input
                id="lead-company"
                name="company"
                type="text"
                autoComplete="organization"
                maxLength={160}
                className={inputClass}
              />
            </FieldRow>

            <FieldRow id="lead-message" label="How can they help?" required>
              <textarea
                id="lead-message"
                name="message"
                required
                rows={5}
                maxLength={5_000}
                placeholder="A sentence or two about what you need and when."
                className={textareaClass}
              />
            </FieldRow>

            {form.fields.map((field) => (
              <CustomField key={field.name} field={field} />
            ))}

            {/*
              Honeypot: people never see or reach it (off-screen, out of the tab
              order, hidden from assistive tech); bots that fill every input do.
            */}
            <div
              aria-hidden="true"
              style={{ position: "absolute", left: "-10000px", top: "auto", width: 1, height: 1, overflow: "hidden" }}
            >
              <label htmlFor="lead-hp">Leave this field empty</label>
              <input id="lead-hp" name={form.honeypotField} type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
            </div>

            <input type="hidden" name="formSlug" value={form.slug} />
            {embed ? <input type="hidden" name="embed" value="1" /> : null}
            <BrowserTimeZoneInput name="leadTimezone" />

            <div className="grid gap-3 pt-1">
              <SendButton pendingLabel="Sending">Send message</SendButton>
              <p className="text-center text-xs leading-relaxed text-foreground/65">
                Your details go to {orgName} only, so they can reply to you.
              </p>
            </div>
          </form>
        </PublicCard>
      )}
      <FormDraftKeeper
        formId={FORM_ID}
        draftKey={form.slug}
        mode={sent ? "clear" : error ? "restore" : "keep"}
        skip={[form.honeypotField, "formSlug", "leadTimezone"]}
        alertId={error ? ALERT_ID : undefined}
      />
    </PublicShell>
  );
}

const AUTOCOMPLETE: Partial<Record<FormField["type"], string>> = { email: "email", tel: "tel", url: "url" };
const INPUT_MODE: Partial<Record<FormField["type"], "email" | "tel" | "url">> = {
  email: "email",
  tel: "tel",
  url: "url",
};

function CustomField({ field }: { field: FormField }) {
  const id = `lead-custom-${field.name}`;
  const name = `custom.${field.name}`;
  const required = Boolean(field.required);
  const options = (field.options ?? []).filter((option) => option.trim().length > 0);

  if (field.type === "textarea") {
    return (
      <FieldRow id={id} label={field.label} required={required}>
        <textarea
          id={id}
          name={name}
          required={required}
          rows={4}
          maxLength={2_000}
          placeholder={field.placeholder}
          className={textareaClass}
        />
      </FieldRow>
    );
  }

  if (field.type === "select" && options.length > 0) {
    return (
      <FieldRow id={id} label={field.label} required={required}>
        <SelectFrame>
          <select id={id} name={name} required={required} defaultValue="" className={selectClass}>
            <option value="" disabled={required}>
              {field.placeholder || "Choose one"}
            </option>
            {options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </SelectFrame>
      </FieldRow>
    );
  }

  const type = field.type === "email" || field.type === "tel" || field.type === "url" ? field.type : "text";
  return (
    <FieldRow id={id} label={field.label} required={required}>
      <input
        id={id}
        name={name}
        type={type}
        required={required}
        maxLength={500}
        autoComplete={AUTOCOMPLETE[field.type]}
        inputMode={INPUT_MODE[field.type]}
        placeholder={field.placeholder}
        className={inputClass}
      />
    </FieldRow>
  );
}

function SentPanel({ orgName, againHref, compact }: { orgName: string; againHref: string; compact: boolean }) {
  return (
    <PublicCard className={cn(compact && "rounded-2xl p-4 shadow-none sm:p-5")}>
      <Pill tone="sea">
        <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
        Message sent
      </Pill>
      <h1 className={cn("mt-4 leading-[1.1] text-balance break-words", compact ? "text-2xl" : "text-[1.75rem] sm:text-4xl")}>
        Thanks! Your message is with {orgName}.
      </h1>
      <p className="mt-3 text-[0.9375rem] leading-relaxed text-foreground/80">
        {orgName} usually replies within a minute. Check your inbox.
      </p>

      <div className="mt-6 flex items-center gap-4 rounded-2xl bg-foreground px-5 py-4 text-background">
        <Dot />
        <div className="min-w-0">
          <ElapsedClock className="block text-4xl leading-none text-background sm:text-5xl" />
          <p className="mt-1.5 text-sm text-background/75">on the clock since you pressed send</p>
        </div>
      </div>

      <p className="mt-6 text-sm text-foreground/75">
        Something to add?{" "}
        <Link href={againHref} className={cn(textLink, "font-semibold text-foreground")}>
          Send another message
        </Link>
      </p>
    </PublicCard>
  );
}
