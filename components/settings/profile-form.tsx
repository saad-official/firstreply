"use client";

import { useRef, useState } from "react";
import { LocateFixed } from "lucide-react";
import { saveProfileAction } from "@/app/(app)/settings/actions";
import { FormMessage } from "@/components/app/form-message";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CopyField } from "./copy-button";
import { Field, selectClass } from "./fields";
import { SaveButton } from "./save-button";
import { useToastAction } from "./use-toast-action";

export type ProfileValues = {
  name: string;
  timezone: string;
  bookingSlug: string;
  meetingLengthMinutes: number;
  bufferMinutes: number;
  minNoticeHours: number;
  horizonBusinessDays: number;
};

export function ProfileForm({
  values,
  timeZones,
  appUrl,
}: {
  values: ProfileValues;
  /** IANA zones from the server (Intl.supportedValuesOf), so server and client render the same list. */
  timeZones: string[];
  appUrl: string;
}) {
  const { state, onSubmit, pending } = useToastAction(saveProfileAction);
  const [slug, setSlug] = useState(values.bookingSlug);
  const zoneRef = useRef<HTMLSelectElement>(null);
  const [zoneNote, setZoneNote] = useState<string | null>(null);
  const savedLink = `${appUrl}/b/${values.bookingSlug}`;
  const draftSlug = slug.trim().toLowerCase();

  function applyBrowserZone() {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const select = zoneRef.current;
    if (!select || !zone) {
      setZoneNote("Your browser didn't report a time zone; pick it from the list.");
      return;
    }
    // Browsers and the server's ICU can name a zone differently (Asia/Kolkata vs Asia/Calcutta).
    if (!Array.from(select.options).some((o) => o.value === zone)) {
      select.add(new Option(zone.replaceAll("_", " "), zone));
    }
    select.value = zone;
    setZoneNote(`Set to ${zone}. Save to apply.`);
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-6">
      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="profile-name" label="Business name" hint="Shown on your booking page and in reply signatures.">
          <Input
            id="profile-name"
            name="name"
            defaultValue={values.name}
            required
            maxLength={120}
            autoComplete="organization"
            aria-describedby="profile-name-hint"
          />
        </Field>

        <Field
          id="profile-timezone"
          label="Time zone"
          hint={
            <>
              Availability and slot times use this zone.{" "}
              <Button
                type="button"
                variant="link"
                size="xs"
                className="h-auto px-0 align-baseline text-xs"
                onClick={applyBrowserZone}
              >
                <LocateFixed aria-hidden />
                Use my browser&apos;s zone
              </Button>
              {zoneNote ? (
                <span role="status" className="block">
                  {zoneNote}
                </span>
              ) : null}
            </>
          }
        >
          <select
            id="profile-timezone"
            name="timezone"
            ref={zoneRef}
            defaultValue={values.timezone}
            className={selectClass}
            aria-describedby="profile-timezone-hint"
            required
          >
            {timeZones.map((zone) => (
              <option key={zone} value={zone}>
                {zone.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field
        id="profile-slug"
        label="Booking link"
        hint="Lower-case letters, digits and hyphens. Changing it breaks links you have already shared."
      >
        <div className="flex min-w-0 items-center overflow-hidden rounded-lg border border-input focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
          <span className="hidden shrink-0 border-r bg-muted px-2.5 py-1.5 font-mono text-xs text-muted-foreground sm:inline">
            /b/
          </span>
          <Input
            id="profile-slug"
            name="bookingSlug"
            defaultValue={values.bookingSlug}
            onChange={(e) => setSlug(e.target.value)}
            required
            maxLength={48}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="rounded-none border-0 font-mono focus-visible:ring-0"
            aria-describedby="profile-slug-hint"
          />
        </div>
      </Field>
      <div className="-mt-3 grid gap-1.5">
        <p className="text-xs font-medium text-muted-foreground">Your booking page</p>
        <CopyField value={savedLink} label="Copy booking link" />
        {draftSlug && draftSlug !== values.bookingSlug ? (
          <p className="text-xs text-muted-foreground">
            After saving: <span className="font-mono break-all text-foreground">{`${appUrl}/b/${draftSlug}`}</span>
          </p>
        ) : null}
      </div>

      <fieldset className="grid gap-5 rounded-xl bg-muted/50 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <legend className="sr-only">Meeting rules</legend>
        <Field id="profile-length" label="Meeting length">
          <select
            id="profile-length"
            name="meetingLengthMinutes"
            defaultValue={String(values.meetingLengthMinutes)}
            className={selectClass}
          >
            <option value="15">15 minutes</option>
            <option value="30">30 minutes</option>
            <option value="45">45 minutes</option>
          </select>
        </Field>
        <Field id="profile-buffer" label="Buffer (minutes)" hint="Gap kept free after each meeting. 0 to 240.">
          <Input
            id="profile-buffer"
            name="bufferMinutes"
            type="number"
            inputMode="numeric"
            min={0}
            max={240}
            step={5}
            required
            defaultValue={values.bufferMinutes}
            className="stopwatch"
            aria-describedby="profile-buffer-hint"
          />
        </Field>
        <Field id="profile-notice" label="Minimum notice (hours)" hint="No slots sooner than this. 0 to 336.">
          <Input
            id="profile-notice"
            name="minNoticeHours"
            type="number"
            inputMode="numeric"
            min={0}
            max={336}
            required
            defaultValue={values.minNoticeHours}
            className="stopwatch"
            aria-describedby="profile-notice-hint"
          />
        </Field>
        <Field id="profile-horizon" label="Horizon (business days)" hint="How far ahead slots are offered. 1 to 60.">
          <Input
            id="profile-horizon"
            name="horizonBusinessDays"
            type="number"
            inputMode="numeric"
            min={1}
            max={60}
            required
            defaultValue={values.horizonBusinessDays}
            className="stopwatch"
            aria-describedby="profile-horizon-hint"
          />
        </Field>
      </fieldset>

      <FormMessage error={state.ok ? null : state.error} upgradeUrl={state.upgradeUrl} />
      <div>
        <SaveButton pending={pending} pendingLabel="Saving">
          Save profile
        </SaveButton>
      </div>
    </form>
  );
}
