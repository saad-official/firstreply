"use client";

import { saveVoiceAction } from "@/app/(app)/settings/actions";
import { FormMessage } from "@/components/app/form-message";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "./fields";
import { SaveButton } from "./save-button";
import { useToastAction } from "./use-toast-action";

export type VoiceValues = {
  tone: string;
  senderName: string;
  signOff: string;
  notes: string;
  declineResourceUrl: string;
};

export function VoiceForm({ values }: { values: VoiceValues }) {
  const { state, onSubmit, pending } = useToastAction(saveVoiceAction);

  return (
    <form onSubmit={onSubmit} className="grid gap-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="voice-tone" label="Tone" hint={"A few words, e.g. “warm, direct, no jargon”."}>
          <Input
            id="voice-tone"
            name="tone"
            defaultValue={values.tone}
            maxLength={200}
            placeholder="Warm, direct, no jargon"
            aria-describedby="voice-tone-hint"
          />
        </Field>
        <Field id="voice-sender" label="Sender name" hint="The name replies are written as.">
          <Input
            id="voice-sender"
            name="senderName"
            defaultValue={values.senderName}
            maxLength={80}
            autoComplete="name"
            placeholder="Sam"
            aria-describedby="voice-sender-hint"
          />
        </Field>
      </div>

      <Field id="voice-signoff" label="Sign-off and signature" hint="Added to the end of every reply; line breaks are kept.">
        <Textarea
          id="voice-signoff"
          name="signOff"
          defaultValue={values.signOff}
          maxLength={500}
          rows={3}
          className="font-mono text-sm leading-relaxed"
          placeholder={"Best,\nSam\nNorthwind Studio"}
          aria-describedby="voice-signoff-hint"
        />
      </Field>

      <Field
        id="voice-notes"
        label="Notes for the writer"
        hint={"Habits to keep or avoid, e.g. “never quote a price in the first reply; use British spelling”."}
      >
        <Textarea
          id="voice-notes"
          name="notes"
          defaultValue={values.notes}
          maxLength={1000}
          rows={3}
          aria-describedby="voice-notes-hint"
        />
      </Field>

      <Field
        id="voice-decline"
        label="Decline resource link"
        hint="The one helpful link a polite decline offers to leads that are not a fit (a guide, a directory, a cheaper option). Leave it empty to decline without a link."
      >
        <Input
          id="voice-decline"
          name="declineResourceUrl"
          type="url"
          inputMode="url"
          defaultValue={values.declineResourceUrl}
          maxLength={1000}
          placeholder="https://example.com/resources"
          className="font-mono text-sm"
          aria-describedby="voice-decline-hint"
        />
      </Field>

      <FormMessage error={state.ok ? null : state.error} upgradeUrl={state.upgradeUrl} />
      <div>
        <SaveButton pending={pending} pendingLabel="Saving">
          Save voice
        </SaveButton>
      </div>
    </form>
  );
}
