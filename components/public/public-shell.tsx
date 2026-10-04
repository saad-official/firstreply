import Link from "next/link";
import { coralInkVar, focusRing } from "@/components/marketing/site";
import { Dot, Wordmark } from "@/components/marketing/wordmark";
import { cn } from "@/lib/utils";

/**
 * Chrome for the public, no-account pages a lead sees (hosted form, booking
 * page): cream page, a dotgrid band behind the top, the Firstreply wordmark,
 * one centred column, and a quiet "powered by" footer. No app navigation.
 *
 * `embed` drops the header and footer for the iframe embed; the skip link and
 * the coral-ink variable stay so the page still works on its own.
 */
export function PublicShell({
  children,
  embed = false,
  width = "md",
}: {
  children: React.ReactNode;
  embed?: boolean;
  /** Column width: `md` for a single form, `lg` for the booking page. */
  width?: "md" | "lg";
}) {
  const column = cn("mx-auto w-full px-4 sm:px-6", width === "lg" ? "max-w-3xl" : "max-w-xl");

  if (embed) {
    return (
      <div className="flex min-h-dvh flex-col overflow-x-clip bg-background" style={coralInkVar}>
        <main id="main" tabIndex={-1} className={cn(column, "flex-1 py-4 outline-none")}>
          {children}
        </main>
      </div>
    );
  }

  return (
    <div className="relative isolate flex min-h-dvh flex-col overflow-x-clip bg-background" style={coralInkVar}>
      <a
        href="#main"
        className="sr-only z-50 rounded-full bg-foreground px-4 py-2 text-sm font-semibold text-background focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-foreground"
      >
        Skip to content
      </a>
      {/* Dot grid band behind the header and the top of the card, fading out downwards. */}
      <div
        aria-hidden="true"
        className="dotgrid pointer-events-none absolute inset-x-0 top-0 -z-10 h-80 [mask-image:linear-gradient(to_bottom,black_40%,transparent)] sm:h-96"
      />
      <header className={cn(column, "flex items-center justify-between gap-4 pt-6 pb-8 sm:pt-8 sm:pb-10")}>
        <Wordmark />
      </header>
      <main id="main" tabIndex={-1} className={cn(column, "flex-1 pb-12 outline-none")}>
        {children}
      </main>
      <footer className={cn(column, "pb-8")}>
        <p className="flex items-center justify-center gap-2 text-sm text-foreground/70">
          <Dot />
          <Link href="/" className={cn("hover:text-foreground hover:underline underline-offset-4", focusRing)}>
            Replies powered by Firstreply
          </Link>
        </p>
      </footer>
    </div>
  );
}

/** The white card the form or booking flow sits in. */
export function PublicCard({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("min-w-0 rounded-3xl bg-card p-5 shadow-card ring-1 ring-foreground/10 sm:p-8", className)}>
      {children}
    </div>
  );
}
