import type { CSSProperties } from "react";

/**
 * Shared constants and class strings for the marketing site, so the header,
 * footer and pages all link to the same places and share one focus style.
 */

export const links = {
  repo: "https://github.com/saad-official/firstreply",
  series: "https://github.com/saad-official/vibe-build-series",
  signIn: "/sign-in",
  signUp: "/sign-up",
  howItWorks: "/#how-it-works",
  pricing: "/pricing",
  privacy: "/privacy",
  terms: "/terms",
} as const;

/** Page container: max-w-6xl with a 16px gutter on phones. */
export const container = "mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8";

/**
 * High-contrast focus outline (night, solid) for links, summaries and CTAs.
 * The global ring is coral at 50%, which is too faint on cream.
 */
export const focusRing =
  "rounded-sm outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-4 focus-visible:outline-foreground";

/** Inline text link: underlined, darker on hover, visible focus. */
export const textLink =
  "rounded-sm underline decoration-foreground/30 decoration-1 underline-offset-4 hover:decoration-foreground outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-foreground";

/**
 * Coral as set in globals.css is 3.6:1 against white text and cream, which is
 * fine for dots and large numerals but not for button labels or small text.
 * `--coral-ink` (defined on the marketing layout wrapper) is the same hue
 * pulled 18% toward night: 5.3:1 under white, 4.9:1 on cream.
 */
export const coralInkVar = {
  "--coral-ink": "color-mix(in oklch, var(--coral) 82%, var(--night))",
} as CSSProperties;
