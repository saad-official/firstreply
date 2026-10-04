"use client";

import { useState } from "react";
import { saveAvailabilityAction } from "@/app/(app)/settings/actions";
import { FormMessage } from "@/components/app/form-message";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { minutesToTime, timeToMinutes } from "@/lib/format";
import { cn } from "@/lib/utils";
import { SaveButton } from "./save-button";
import { useToastAction } from "./use-toast-action";

export type DayWindows = { weekday: number; windows: { startMinute: number; endMinute: number }[] };

/** Monday first on screen; stored as 0 = Sunday .. 6 = Saturday. */
const DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

type Row = { on: boolean; start: string; end: string };

/**
 * One editable window per weekday. When a day already has more than one
 * window (seeded or set through the API), the first is editable here and the
 * rest are sent back unchanged in a hidden field, so saving never drops them.
 * Unticking the day removes all of its windows.
 */
export function AvailabilityForm({ days, timezone }: { days: DayWindows[]; timezone: string }) {
  const { state, onSubmit, pending } = useToastAction(saveAvailabilityAction);
  const byDay = new Map(days.map((d) => [d.weekday, d.windows]));
  const [rows, setRows] = useState<Record<number, Row>>(() => {
    const out: Record<number, Row> = {};
    for (let d = 0; d <= 6; d++) {
      const first = byDay.get(d)?.[0];
      out[d] = first
        ? { on: true, start: minutesToTime(first.startMinute), end: minutesToTime(Math.min(first.endMinute, 1439)) } // type="time" stops at 23:59
        : { on: false, start: "09:00", end: "17:00" };
    }
    return out;
  });

  function update(weekday: number, patch: Partial<Row>) {
    setRows((prev) => ({ ...prev, [weekday]: { ...prev[weekday], ...patch } }));
  }

  const weeklyMinutes = DISPLAY_ORDER.reduce<number>((sum, d) => {
    const row = rows[d];
    if (!row.on) return sum;
    const s = timeToMinutes(row.start);
    const e = timeToMinutes(row.end);
    const first = s !== null && e !== null && e > s ? e - s : 0;
    const extra = (byDay.get(d) ?? []).slice(1).reduce((acc, w) => acc + (w.endMinute - w.startMinute), 0);
    return sum + first + extra;
  }, 0);

  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm text-muted-foreground">
        <p>
          Times are in <span className="font-medium text-foreground">{timezone.replaceAll("_", " ")}</span>.
        </p>
        <p aria-live="polite">
          <span className="stopwatch text-foreground">{(weeklyMinutes / 60).toFixed(weeklyMinutes % 60 ? 1 : 0)}h</span>{" "}
          bookable a week
        </p>
      </div>

      <ul className="divide-y divide-border rounded-xl ring-1 ring-foreground/10">
        {DISPLAY_ORDER.map((weekday) => {
          const row = rows[weekday];
          const name = DAY_NAMES[weekday];
          const extra = (byDay.get(weekday) ?? []).slice(1);
          const id = `avail-${weekday}`;
          return (
            <li
              key={weekday}
              className={cn(
                "grid gap-3 px-3 py-3 sm:grid-cols-[9rem_1fr] sm:items-center sm:px-4",
                !row.on && "bg-muted/40",
              )}
            >
              <div className="flex items-center gap-2.5">
                <input
                  id={`${id}-on`}
                  name={`day-${weekday}-on`}
                  type="checkbox"
                  checked={row.on}
                  onChange={(e) => update(weekday, { on: e.target.checked })}
                  className="size-4 shrink-0 rounded accent-coral-ink outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                />
                <Label htmlFor={`${id}-on`} className="font-semibold">
                  {name}
                </Label>
                {!row.on ? <span className="text-xs text-muted-foreground sm:hidden">Unavailable</span> : null}
              </div>

              {row.on ? (
                <div className="grid gap-2">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <div className="flex items-center gap-2">
                      <Label htmlFor={`${id}-start`} className="text-xs text-muted-foreground">
                        <span className="sr-only">{name} </span>From
                      </Label>
                      <Input
                        id={`${id}-start`}
                        name={`day-${weekday}-start`}
                        type="time"
                        step={900}
                        required
                        value={row.start}
                        onChange={(e) => update(weekday, { start: e.target.value })}
                        className="stopwatch w-[7.5rem]"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <Label htmlFor={`${id}-end`} className="text-xs text-muted-foreground">
                        <span className="sr-only">{name} </span>to
                      </Label>
                      <Input
                        id={`${id}-end`}
                        name={`day-${weekday}-end`}
                        type="time"
                        step={900}
                        required
                        value={row.end}
                        onChange={(e) => update(weekday, { end: e.target.value })}
                        className="stopwatch w-[7.5rem]"
                      />
                    </div>
                  </div>
                  {extra.length > 0 ? (
                    <>
                      <input
                        type="hidden"
                        name={`day-${weekday}-extra`}
                        value={extra.map((w) => `${w.startMinute}-${w.endMinute}`).join(",")}
                      />
                      <p className="text-xs text-muted-foreground">
                        Also{" "}
                        {extra.map((w, i) => (
                          <span key={`${w.startMinute}-${w.endMinute}`}>
                            {i > 0 ? ", " : null}
                            <span className="stopwatch text-foreground">
                              {minutesToTime(w.startMinute)}–{minutesToTime(w.endMinute)}
                            </span>
                          </span>
                        ))}{" "}
                        (kept as is; untick the day to clear all of its windows).
                      </p>
                    </>
                  ) : null}
                </div>
              ) : (
                <p className="hidden text-sm text-muted-foreground sm:block">Unavailable</p>
              )}
            </li>
          );
        })}
      </ul>

      <FormMessage error={state.ok ? null : state.error} upgradeUrl={state.upgradeUrl} />
      <div>
        <SaveButton pending={pending} pendingLabel="Saving">
          Save availability
        </SaveButton>
      </div>
    </form>
  );
}
