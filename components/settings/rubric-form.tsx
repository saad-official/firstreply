"use client";

import { useRef, useState } from "react";
import { saveRubricAction } from "@/app/(app)/settings/actions";
import { FormMessage } from "@/components/app/form-message";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "./fields";
import { SaveButton } from "./save-button";
import { useToastAction } from "./use-toast-action";

const EXAMPLES = [
  {
    name: "Web design studio",
    offer: "A 30-minute intro call",
    rubric:
      "Good fit: B2B companies with 10 to 200 staff that need a new marketing site or a redesign, with a budget from $8k and a launch within the next three months.\n\nNot a fit: students, job seekers, agencies asking us to white-label, one-page sites under $2k, and anyone pitching SEO or link building.",
  },
  {
    name: "Bookkeeping practice",
    offer: "A 15-minute fit call",
    rubric:
      "Good fit: small businesses (1 to 50 staff) that want monthly bookkeeping, payroll or quarterly tax filings, ideally already on Xero or QuickBooks.\n\nNot a fit: one-off personal tax returns, businesses outside the countries we serve, and vendors selling software or offshore staffing.",
  },
  {
    name: "Sales consultant",
    offer: "A 45-minute discovery call",
    rubric:
      "Good fit: founders or heads of sales at seed to Series B SaaS companies who want help building a repeatable outbound process, with a team of 2 to 15 reps.\n\nNot a fit: B2C businesses, people looking for a job, requests for free advice only, and vendors pitching lead lists.",
  },
] as const;

type Example = (typeof EXAMPLES)[number];

export function RubricForm({ rubric, offer }: { rubric: string; offer: string }) {
  const { state, onSubmit, pending } = useToastAction(saveRubricAction);
  const [text, setText] = useState(rubric);
  const offerRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  function applyExample(example: Example) {
    setText(example.rubric);
    if (offerRef.current && !offerRef.current.value.trim()) offerRef.current.value = example.offer;
    textRef.current?.focus();
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-5">
      <div className="grid gap-2">
        <p id="rubric-examples-label" className="text-xs font-medium text-muted-foreground">
          Start from an example (it replaces the text below; nothing is saved until you press Save)
        </p>
        <div role="group" aria-labelledby="rubric-examples-label" className="flex flex-wrap gap-2">
          {EXAMPLES.map((example) => (
            <button
              key={example.name}
              type="button"
              onClick={() => applyExample(example)}
              className="pill border border-border bg-background text-foreground/80 transition-colors outline-none hover:border-coral-ink hover:text-coral-ink focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {example.name}
            </button>
          ))}
        </div>
      </div>

      <Field
        id="rubric-text"
        label="Who is a fit, and who is not"
        hint="Plain English. Every new lead gets a 0 to 100 score and a one-line reason against this."
      >
        <Textarea
          id="rubric-text"
          ref={textRef}
          name="rubric"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={5000}
          rows={7}
          className="min-h-40 leading-relaxed"
          placeholder={"Good fit: ...\n\nNot a fit: ..."}
          aria-describedby="rubric-text-hint rubric-text-count"
        />
        <p id="rubric-text-count" className="stopwatch text-right text-xs text-muted-foreground">
          {text.length.toLocaleString("en-US")} / 5,000
        </p>
      </Field>

      <Field
        id="rubric-offer"
        label="What the first reply offers"
        hint={"Written into every reply to a good-fit lead, e.g. “a 30-minute intro call”."}
      >
        <Input
          id="rubric-offer"
          ref={offerRef}
          name="offer"
          defaultValue={offer}
          maxLength={300}
          placeholder="A 30-minute intro call"
          aria-describedby="rubric-offer-hint"
        />
      </Field>

      <FormMessage error={state.ok ? null : state.error} upgradeUrl={state.upgradeUrl} />
      <div>
        <SaveButton pending={pending} pendingLabel="Saving">
          Save rubric
        </SaveButton>
      </div>
    </form>
  );
}
