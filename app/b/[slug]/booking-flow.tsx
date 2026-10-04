"use client";

import { usePathname, useRouter } from "next/navigation";
import {
  useActionState,
  useEffect,
  useId,
  useOptimistic,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import { focusRing } from "@/components/marketing/site";
import { useBrowserTimeZone } from "@/components/public/browser-timezone";
import {
  FieldRow,
  FormAlert,
  SelectFrame,
  describedBy,
  inputClass,
  primaryButtonClass,
  selectClass,
  textareaClass,
} from "@/components/public/fields";
import type { BookingDay, BookingSlot } from "@/lib/services/booking";
import { cn } from "@/lib/utils";
import { bookSlotAction, type BookingActionState } from "./actions";

const IDLE: BookingActionState = { status: "idle" };

type Props = {
  slug: string;
  orgName: string;
  /** Zone the days and labels are in (the visitor's when valid, else the org's). */
  timezone: string;
  /** False on a first visit (no valid ?tz=): the browser zone replaces it. */
  hasZoneParam: boolean;
  meetingLengthMinutes: number;
  days: BookingDay[];
};

export function BookingFlow({ slug, orgName, timezone, hasZoneParam, meetingLengthMinutes, days }: Props) {
  const router = useRouter();
  const [state, formAction, submitting] = useActionState(async (prev: BookingActionState, formData: FormData) => {
    const result = await bookSlotAction(prev, formData);
    // Someone else got there first: fetch the current free list.
    if (result.status === "error" && result.slotTaken) router.refresh();
    return result;
  }, IDLE);

  const [dayDate, setDayDate] = useState<string | null>(null);
  const [startsAt, setStartsAt] = useState<string | null>(null);
  const confirmRef = useRef<HTMLElement>(null);
  const takenRef = useRef<HTMLDivElement>(null);
  const bookedRef = useRef<HTMLHeadingElement>(null);

  // A selected slot that is no longer free (refresh after a race) simply drops out.
  const selectedDay = startsAt ? days.find((d) => d.slots.some((s) => s.startsAt === startsAt)) : undefined;
  const selected: BookingSlot | undefined = selectedDay?.slots.find((s) => s.startsAt === startsAt);
  const shownDay = days.find((d) => d.date === dayDate) ?? selectedDay ?? days[0];

  const slotTaken = state.status === "error" && state.slotTaken ? state : null;
  const showTaken = slotTaken !== null && (!selected || selected.startsAt === slotTaken.startsAt);

  useEffect(() => {
    if (state.status === "booked") bookedRef.current?.focus();
    else if (state.status === "error" && state.slotTaken) takenRef.current?.focus();
  }, [state]);

  if (state.status === "booked") {
    return <BookedPanel state={state} headingRef={bookedRef} />;
  }

  function chooseDay(date: string) {
    setDayDate(date);
    setStartsAt(null);
  }

  function chooseSlot(slot: BookingSlot) {
    setStartsAt(slot.startsAt);
    requestAnimationFrame(() => {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      confirmRef.current?.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
    });
  }

  return (
    <div className="mt-7 grid gap-6">
      <TimeZonePicker slug={slug} timezone={timezone} hasZoneParam={hasZoneParam} />

      {showTaken ? (
        <div ref={takenRef} tabIndex={-1} className="outline-none">
          <FormAlert title="Just taken">{slotTaken.message}</FormAlert>
        </div>
      ) : null}

      {days.length === 0 || !shownDay ? (
        <EmptyState orgName={orgName} />
      ) : (
        <>
          <DayPicker days={days} shownDate={shownDay.date} onChoose={chooseDay} />
          <SlotGrid day={shownDay} selected={selected?.startsAt ?? null} onChoose={chooseSlot} />
        </>
      )}

      <p aria-live="polite" className="sr-only">
        {selected && selectedDay ? `Selected ${selectedDay.label} at ${selected.label}. Add your details below to confirm.` : ""}
      </p>

      {selected && selectedDay ? (
        <ConfirmForm
          sectionRef={confirmRef}
          slug={slug}
          timezone={timezone}
          day={selectedDay}
          slot={selected}
          meetingLengthMinutes={meetingLengthMinutes}
          state={state}
          submitting={submitting}
          action={formAction}
        />
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------- zones */

type ZoneOption = { value: string; label: string };

let zoneOptionsCache: ZoneOption[] | null = null;

function offsetLabel(zone: string, now: Date): string {
  try {
    const part = new Intl.DateTimeFormat("en-GB", { timeZone: zone, timeZoneName: "shortOffset" })
      .formatToParts(now)
      .find((p) => p.type === "timeZoneName");
    return part ? ` (${part.value})` : "";
  } catch {
    return "";
  }
}

/** Every zone the browser knows, labelled with its current UTC offset; built once per page load. */
function readZoneOptions(): ZoneOption[] {
  if (zoneOptionsCache) return zoneOptionsCache;
  let zones: string[] = [];
  try {
    zones = Intl.supportedValuesOf("timeZone");
  } catch {
    zones = [];
  }
  const now = new Date();
  zoneOptionsCache = zones.map((zone) => ({ value: zone, label: zoneName(zone) + offsetLabel(zone, now) }));
  return zoneOptionsCache;
}

const noSubscribe = () => () => {};

function zoneName(zone: string): string {
  return zone.replaceAll("_", " ");
}

function TimeZonePicker({ slug, timezone, hasZoneParam }: { slug: string; timezone: string; hasZoneParam: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const browserZone = useBrowserTimeZone();
  const [pending, startTransition] = useTransition();
  // Show the chosen zone straight away while the page fetches times for it.
  const [shownZone, setShownZone] = useOptimistic(timezone);
  // Server render and hydration: only the current zone (offset labels can differ
  // between server and browser). The full list follows right after hydration.
  const all = useSyncExternalStore(noSubscribe, readZoneOptions, () => null);
  const id = useId();

  const options: ZoneOption[] = all
    ? all.some((o) => o.value === shownZone)
      ? all
      : [{ value: shownZone, label: zoneName(shownZone) }, ...all]
    : [{ value: shownZone, label: zoneName(shownZone) }];

  function show(zone: string) {
    startTransition(() => {
      setShownZone(zone);
      router.replace(`${pathname}?tz=${encodeURIComponent(zone)}`, { scroll: false });
    });
  }

  // First visit: show times in the visitor's own zone.
  useEffect(() => {
    if (hasZoneParam || !browserZone || browserZone === timezone) return;
    startTransition(() => {
      router.replace(`${pathname}?tz=${encodeURIComponent(browserZone)}`, { scroll: false });
    });
  }, [hasZoneParam, browserZone, timezone, pathname, router]);

  return (
    // Without JavaScript the select still works through a plain GET.
    <form method="get" action={`/b/${encodeURIComponent(slug)}`} className="grid gap-1.5" aria-busy={pending || undefined}>
      <label htmlFor={id} className="text-sm font-semibold">
        Times shown in
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <SelectFrame className="w-full sm:w-80">
          <select
            id={id}
            name="tz"
            value={shownZone}
            onChange={(event) => show(event.target.value)}
            className={selectClass}
            aria-describedby={`${id}-hint`}
          >
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </SelectFrame>
        <noscript>
          <button type="submit" className={cn("h-11 rounded-full border border-foreground/25 bg-card px-5 text-sm font-semibold", focusRing)}>
            Show times
          </button>
        </noscript>
      </div>
      <p id={`${id}-hint`} className="text-xs text-foreground/65" aria-live="polite">
        {pending ? "Updating times…" : browserZone && browserZone !== timezone ? `Your device is set to ${zoneName(browserZone)}.` : "Change it if you'll be somewhere else."}
      </p>
    </form>
  );
}

/* ---------------------------------------------------------------- days and slots */

const dayParts = {
  weekday: new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short" }),
  day: new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric" }),
  month: new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", month: "short" }),
};

/** "2026-10-06" → { weekday: "Tue", day: "6", month: "Oct" }, the same on server and browser. */
function shortDay(date: string) {
  const noon = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(noon.getTime())) return { weekday: "", day: date, month: "" };
  return { weekday: dayParts.weekday.format(noon), day: dayParts.day.format(noon), month: dayParts.month.format(noon) };
}

function DayPicker({ days, shownDate, onChoose }: { days: BookingDay[]; shownDate: string; onChoose: (date: string) => void }) {
  return (
    <div role="group" aria-label="Choose a day">
      <ul className="grid grid-cols-5 gap-1.5 sm:gap-2">
        {days.map((day) => {
          const parts = shortDay(day.date);
          const active = day.date === shownDate;
          const count = day.slots.length;
          return (
            <li key={day.date} className="min-w-0">
              <button
                type="button"
                aria-pressed={active}
                aria-label={`${day.label}, ${count} ${count === 1 ? "time" : "times"} free`}
                onClick={() => onChoose(day.date)}
                className={cn(
                  "flex min-h-16 w-full flex-col items-center justify-center rounded-xl border px-1 py-2 leading-none outline-none motion-safe:transition-colors",
                  "focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-foreground",
                  active
                    ? "border-foreground bg-foreground text-background"
                    : "border-border bg-background text-foreground hover:border-foreground/60",
                )}
              >
                <span className={cn("text-[0.6875rem] font-semibold", active ? "text-background/80" : "text-foreground/65")}>
                  {parts.weekday}
                </span>
                <span className="stopwatch mt-1 text-lg font-semibold">{parts.day}</span>
                <span className={cn("mt-1 text-[0.6875rem]", active ? "text-background/80" : "text-foreground/65")}>
                  {parts.month}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function SlotGrid({
  day,
  selected,
  onChoose,
}: {
  day: BookingDay;
  selected: string | null;
  onChoose: (slot: BookingSlot) => void;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="grid gap-3">
      <h2 id={headingId} className="font-sans text-base font-semibold tracking-normal">
        {day.label}
      </h2>
      <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
        {day.slots.map((slot) => {
          const active = slot.startsAt === selected;
          return (
            <li key={slot.startsAt} className="min-w-0">
              <button
                type="button"
                aria-pressed={active}
                onClick={() => onChoose(slot)}
                className={cn(
                  "stopwatch flex h-11 w-full items-center justify-center gap-2 rounded-xl border text-[0.9375rem] outline-none motion-safe:transition-colors",
                  "focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-foreground",
                  active
                    ? "border-sea bg-sea text-sea-foreground"
                    : "border-border bg-background text-foreground hover:border-foreground/60",
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn("size-1.5 shrink-0 rounded-full", active ? "bg-sea-foreground" : "bg-sea")}
                />
                {slot.label}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function EmptyState({ orgName }: { orgName: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-foreground/20 bg-background px-5 py-8 text-center">
      <p aria-hidden="true" className="stopwatch text-4xl text-foreground/40">
        --:--
      </p>
      <h2 className="mt-3 font-sans text-base font-semibold tracking-normal">No open times right now</h2>
      <p className="mx-auto mt-1.5 max-w-sm text-sm leading-relaxed text-foreground/75">
        {orgName} has no free slots in the next two weeks. Check back soon, or reply to their email to suggest a time.
      </p>
    </div>
  );
}

/* ---------------------------------------------------------------- confirm */

const EMAIL_HINT = "The calendar invite goes here.";

function zoneFormat(timezone: string) {
  return {
    day: new Intl.DateTimeFormat("en-GB", { timeZone: timezone, weekday: "long", day: "numeric", month: "long" }),
    time: new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }),
  };
}

function ConfirmForm({
  sectionRef,
  slug,
  timezone,
  day,
  slot,
  meetingLengthMinutes,
  state,
  submitting,
  action,
}: {
  sectionRef: React.RefObject<HTMLElement | null>;
  slug: string;
  timezone: string;
  day: BookingDay;
  slot: BookingSlot;
  meetingLengthMinutes: number;
  state: BookingActionState;
  submitting: boolean;
  action: (formData: FormData) => void;
}) {
  const headingId = useId();
  const error = state.status === "error" && !state.slotTaken ? state : null;
  const values = state.status === "error" ? state.values : undefined;
  const fieldErrors = error?.fieldErrors ?? {};
  const end = zoneFormat(timezone).time.format(new Date(slot.endsAt));

  return (
    <section ref={sectionRef} aria-labelledby={headingId} className="scroll-mt-4 rounded-2xl bg-foreground/[0.035] p-4 ring-1 ring-foreground/10 sm:p-6">
      <h2 id={headingId} className="font-sans text-base font-semibold tracking-normal">
        Confirm your time
      </h2>
      <p className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-semibold">{day.label}</span>
        <span className="stopwatch text-lg">
          {slot.label}–{end}
        </span>
        <span className="text-sm text-foreground/65">
          {meetingLengthMinutes} min · {zoneName(timezone)}
        </span>
      </p>

      <form action={action} className="mt-5 grid gap-5" noValidate>
        {error ? <FormAlert>{error.message}</FormAlert> : null}

        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="startsAt" value={slot.startsAt} />
        <input type="hidden" name="timezone" value={timezone} />

        <div className="grid gap-5 sm:grid-cols-2">
          <FieldRow id="book-name" label="Your name" required error={fieldErrors.name}>
            <input
              id="book-name"
              name="name"
              type="text"
              autoComplete="name"
              required
              maxLength={120}
              defaultValue={values?.name}
              aria-invalid={fieldErrors.name ? true : undefined}
              aria-describedby={describedBy("book-name", { error: fieldErrors.name })}
              className={inputClass}
            />
          </FieldRow>
          <FieldRow
            id="book-email"
            label="Email"
            required
            error={fieldErrors.email}
            hint={EMAIL_HINT}
          >
            <input
              id="book-email"
              name="email"
              type="email"
              autoComplete="email"
              inputMode="email"
              required
              maxLength={254}
              defaultValue={values?.email}
              aria-invalid={fieldErrors.email ? true : undefined}
              aria-describedby={describedBy("book-email", { error: fieldErrors.email, hint: EMAIL_HINT })}
              className={inputClass}
            />
          </FieldRow>
        </div>

        <FieldRow id="book-message" label="Anything they should know?" error={fieldErrors.message}>
          <textarea
            id="book-message"
            name="message"
            rows={3}
            maxLength={2_000}
            defaultValue={values?.message}
            aria-invalid={fieldErrors.message ? true : undefined}
            aria-describedby={describedBy("book-message", { error: fieldErrors.message })}
            className={cn(textareaClass, "min-h-24")}
          />
        </FieldRow>

        <button type="submit" className={cn(primaryButtonClass, "sm:w-auto sm:justify-self-start")} aria-disabled={submitting || undefined} disabled={submitting}>
          {submitting ? (
            <>
              <span aria-hidden="true" className="size-2 rounded-full bg-white motion-safe:animate-pulse" />
              Booking
            </>
          ) : (
            "Confirm booking"
          )}
        </button>
      </form>
    </section>
  );
}

/* ---------------------------------------------------------------- booked */

function BookedPanel({
  state,
  headingRef,
}: {
  state: Extract<BookingActionState, { status: "booked" }>;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
}) {
  const format = zoneFormat(state.timezone);
  const start = new Date(state.startsAt);
  const end = new Date(state.endsAt);

  return (
    <section className="mt-7 rounded-2xl bg-foreground p-5 text-background sm:p-7" aria-labelledby="booked-heading">
      <span className="pill bg-sea text-sea-foreground">
        <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
        Booked
      </span>
      <h2
        id="booked-heading"
        ref={headingRef}
        tabIndex={-1}
        className="mt-4 text-2xl leading-tight text-background outline-none sm:text-3xl"
      >
        You&rsquo;re booked with {state.orgName}
      </h2>
      <p className="mt-4 text-background/85">{format.day.format(start)}</p>
      <p className="stopwatch mt-1 text-3xl leading-none sm:text-5xl">
        {format.time.format(start)}–{format.time.format(end)}
      </p>
      <p className="mt-2 text-sm text-background/70">{zoneName(state.timezone)}</p>

      <p className="mt-6 text-[0.9375rem] leading-relaxed text-background/90">
        A calendar invite is on its way to <span className="font-semibold break-all text-background">{state.email}</span>.
      </p>
      <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-3">
        <a
          href={state.icsPath}
          download
          className="inline-flex h-11 items-center justify-center gap-2 rounded-full border border-cream bg-cream px-5 text-sm font-semibold text-night outline-none hover:bg-transparent hover:text-cream focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-cream motion-safe:transition-colors"
        >
          <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className="size-4">
            <path d="M8 2.5v7.5M4.75 7 8 10.25 11.25 7M3 13.5h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Download .ics
        </a>
      </div>
    </section>
  );
}
