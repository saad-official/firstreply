"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { primaryButtonClass } from "./fields";

/**
 * Small progressive enhancements for the hosted form, which itself is a plain
 * `<form method="post" action="/api/leads">` and works without JavaScript.
 */

/**
 * Submit button that shows a sending state and ignores a second press while
 * the post is in flight (no double leads). Re-arms when the page comes back
 * from the back/forward cache.
 */
export function SendButton({ children, pendingLabel }: { children: React.ReactNode; pendingLabel: string }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const form = ref.current?.form;
    if (!form) return;
    let sending = false;
    const onSubmit = (event: SubmitEvent) => {
      if (event.defaultPrevented) return;
      if (sending) {
        event.preventDefault();
        return;
      }
      sending = true;
      setPending(true);
    };
    const onPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      sending = false;
      setPending(false);
    };
    form.addEventListener("submit", onSubmit);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      form.removeEventListener("submit", onSubmit);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, []);

  return (
    <button ref={ref} type="submit" className={primaryButtonClass} aria-disabled={pending || undefined}>
      {pending ? (
        <>
          <span aria-hidden="true" className="size-2 rounded-full bg-white motion-safe:animate-pulse" />
          {pendingLabel}
        </>
      ) : (
        children
      )}
    </button>
  );
}

const DRAFT_PREFIX = "firstreply:form-draft:";

function storage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Keeps what the visitor typed when the server sends them back with an error
 * (the post is a full page round trip, so the fields would come back empty).
 * The draft lives in this tab's sessionStorage only, is never written for the
 * skipped fields (honeypot, hidden inputs), and is dropped once a message is
 * sent. On an error it also moves focus to the alert so it is announced.
 */
export function FormDraftKeeper({
  formId,
  draftKey,
  mode,
  skip,
  alertId,
}: {
  formId: string;
  draftKey: string;
  mode: "keep" | "restore" | "clear";
  skip: string[];
  alertId?: string;
}) {
  const skipKey = skip.join("|");
  useEffect(() => {
    const store = storage();
    const key = DRAFT_PREFIX + draftKey;
    if (mode === "clear") {
      store?.removeItem(key);
      return;
    }
    const form = document.getElementById(formId);
    if (!(form instanceof HTMLFormElement)) return;
    const skipped = new Set(skipKey.split("|"));

    if (mode === "restore" && store) {
      try {
        const saved: unknown = JSON.parse(store.getItem(key) ?? "null");
        if (saved && typeof saved === "object") {
          for (const [name, value] of Object.entries(saved as Record<string, unknown>)) {
            if (skipped.has(name) || typeof value !== "string") continue;
            const field = form.elements.namedItem(name);
            if (
              field instanceof HTMLInputElement ||
              field instanceof HTMLTextAreaElement ||
              field instanceof HTMLSelectElement
            ) {
              if (!field.value) field.value = value;
            }
          }
        }
      } catch {
        // A corrupt draft is not worth an error; start empty.
      }
    }
    if (mode === "restore" && alertId) document.getElementById(alertId)?.focus();

    const onSubmit = () => {
      if (!store) return;
      const draft: Record<string, string> = {};
      for (const [name, value] of new FormData(form).entries()) {
        if (!skipped.has(name) && typeof value === "string") draft[name] = value.slice(0, 5_000);
      }
      try {
        store.setItem(key, JSON.stringify(draft));
      } catch {
        // Storage full or blocked: the post still goes through.
      }
    };
    form.addEventListener("submit", onSubmit);
    return () => form.removeEventListener("submit", onSubmit);
  }, [formId, draftKey, mode, skipKey, alertId]);

  return null;
}

/**
 * A stopwatch that starts at 00:00 when the thank-you panel appears: the
 * clock the business is now racing. Decorative; the panel text says it in words.
 */
export function ElapsedClock({ className }: { className?: string }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const timer = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - start) / 1000);
      setSeconds(Math.min(elapsed, 59 * 60 + 59));
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);
  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  return (
    <span aria-hidden="true" className={cn("stopwatch tabular", className)}>
      {mm}:{ss}
    </span>
  );
}
