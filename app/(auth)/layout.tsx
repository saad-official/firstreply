import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { coralInkVar, focusRing } from "@/components/marketing/site";
import { Dot } from "@/components/marketing/wordmark";
import { cn } from "@/lib/utils";

const facts = [
  { title: "Scores against your rubric", body: "Plain-English criteria you write, checked on every lead." },
  { title: "Replies with three real slots", body: "Straight from your availability, in the lead's time zone." },
  { title: "You approve, or let Pro auto-send", body: "High-fit leads above your threshold go out on their own." },
];

/** Night wordmark for the cream side; the left panel has its own cream version. */
function AuthWordmark({ tone }: { tone: "night" | "cream" }) {
  return (
    <Link
      href="/"
      aria-label="Firstreply, home"
      className={cn(
        "inline-flex items-center gap-2 rounded-sm outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-4",
        tone === "cream" ? "text-cream focus-visible:outline-cream" : "text-foreground focus-visible:outline-foreground",
      )}
    >
      <span className="font-heading text-[1.375rem] leading-none font-bold tracking-tight">Firstreply</span>
      <Dot className="-mt-3" />
    </Link>
  );
}

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex min-h-svh flex-1 flex-col overflow-x-clip bg-background lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]"
      style={coralInkVar}
    >
      <aside className="relative hidden flex-col justify-between gap-12 overflow-hidden bg-night p-12 text-cream lg:flex">
        <AuthWordmark tone="cream" />

        <div className="max-w-md">
          <p className="font-heading text-4xl leading-[1.08] font-bold tracking-tight text-balance">
            Answer every lead in under a minute.
          </p>

          <div className="mt-8 flex items-center gap-4 rounded-2xl bg-cream/[0.06] px-5 py-4 ring-1 ring-cream/10">
            <Dot />
            <div>
              <p className="stopwatch text-5xl leading-none text-cream">0:48</p>
              <p className="mt-2 text-sm font-semibold text-cream/75">first reply drafted</p>
            </div>
          </div>

          <ul className="mt-8 grid gap-4">
            {facts.map((fact) => (
              <li key={fact.title} className="flex gap-3">
                <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-coral" />
                <div>
                  <p className="font-semibold text-cream">{fact.title}</p>
                  <p className="mt-0.5 text-sm text-cream/70">{fact.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-xs text-cream/60">Inbound only: Firstreply never cold-emails anyone.</p>
      </aside>

      <div className="dotgrid flex flex-1 flex-col px-4 py-6 sm:px-8 sm:py-8">
        <header className="flex items-center justify-between gap-4">
          <div className="lg:invisible">
            <AuthWordmark tone="night" />
          </div>
          <Link
            href="/"
            className={cn(
              "inline-flex items-center gap-1.5 text-sm text-foreground/70 hover:text-foreground motion-safe:transition-colors",
              focusRing,
            )}
          >
            <ArrowLeft className="size-4" aria-hidden />
            Back to home
          </Link>
        </header>
        <main id="main" className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-sm">{children}</div>
        </main>
      </div>
    </div>
  );
}
