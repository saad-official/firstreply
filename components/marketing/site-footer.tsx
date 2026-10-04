import Link from "next/link";
import { cn } from "@/lib/utils";
import { container, focusRing, links } from "./site";
import { Wordmark } from "./wordmark";

const footLink = cn("text-sm text-foreground/75 hover:text-foreground hover:underline underline-offset-4", focusRing);

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-border">
      <div className={cn(container, "grid gap-10 py-12 md:grid-cols-12 md:py-16")}>
        <div className="md:col-span-5">
          <Wordmark />
          <p className="mt-4 max-w-xs font-heading text-lg leading-snug font-semibold">
            Answer every lead in under a minute.
          </p>
          <p className="mt-6 max-w-sm text-sm leading-relaxed text-foreground/75">
            Demo project: Stripe runs in test mode and no real payments are taken. Inbound only: Firstreply never
            cold-emails anyone.
          </p>
        </div>

        <nav aria-label="Product" className="md:col-span-3 md:col-start-7">
          <h2 className="font-sans text-xs font-semibold tracking-normal text-foreground/70">Product</h2>
          <ul className="mt-3 space-y-2.5">
            <li>
              <Link href={links.howItWorks} className={footLink}>
                How it works
              </Link>
            </li>
            <li>
              <Link href={links.pricing} className={footLink}>
                Pricing
              </Link>
            </li>
            <li>
              <Link href={links.signIn} className={footLink}>
                Sign in
              </Link>
            </li>
            <li>
              <Link href={links.signUp} className={footLink}>
                Start free
              </Link>
            </li>
          </ul>
        </nav>

        <nav aria-label="Project" className="md:col-span-3">
          <h2 className="font-sans text-xs font-semibold tracking-normal text-foreground/70">Project</h2>
          <ul className="mt-3 space-y-2.5">
            <li>
              <a href={links.repo} className={footLink}>
                Source on GitHub
              </a>
            </li>
            <li>
              <a href={links.series} className={footLink}>
                Built in public as part of the Vibe Build Series
              </a>
            </li>
            <li>
              <Link href={links.privacy} className={footLink}>
                Privacy
              </Link>
            </li>
            <li>
              <Link href={links.terms} className={footLink}>
                Terms
              </Link>
            </li>
          </ul>
        </nav>
      </div>
      <div className="border-t border-border">
        <p className={cn(container, "py-5 text-xs text-foreground/70")}>
          © 2026 Firstreply. A portfolio demo. People, companies and figures in the product examples are synthetic.
        </p>
      </div>
    </footer>
  );
}
