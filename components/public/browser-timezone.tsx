"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

function readBrowserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
  } catch {
    return "";
  }
}

/**
 * The visitor's IANA time zone, or "" during the server render and the first
 * hydration pass (so server and client markup agree).
 */
export function useBrowserTimeZone(): string {
  return useSyncExternalStore(subscribe, readBrowserTimeZone, () => "");
}

/** Hidden input carrying the visitor's time zone with a native form post (empty without JavaScript). */
export function BrowserTimeZoneInput({ name }: { name: string }) {
  const zone = useBrowserTimeZone();
  return <input type="hidden" name={name} value={zone} />;
}
