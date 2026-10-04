import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/marketing/legal-page";
import { links, textLink } from "@/components/marketing/site";

export const metadata: Metadata = {
  title: "Terms",
  description:
    "The terms for using the Firstreply demo: a portfolio project, inbound use only, test-mode billing, no service guarantees.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return (
    <LegalPage label="Terms" title="Terms for using the demo" updated="2026-10-04">
      <h2>What this is</h2>
      <p>
        Firstreply is a portfolio project, built in public as part of the{" "}
        <a href={links.series} className={textLink}>
          Vibe Build Series
        </a>
        . It is offered as is, for trying the product and reading the code. There is no service level, support
        commitment or guarantee that it will stay online or keep your data.
      </p>

      <h2>Inbound use only</h2>
      <p>Firstreply is for answering people who contacted you first. You agree not to use it to:</p>
      <ul>
        <li>send unsolicited or bulk email, or load lists of people who did not write to you;</li>
        <li>enter real personal data about people who have not agreed to it, on this public demo;</li>
        <li>impersonate another person or business in replies;</li>
        <li>probe, overload or attack the service or the websites enrichment reads.</li>
      </ul>

      <h2>Your replies are yours</h2>
      <p>
        Drafts are written by a language model and checked by rules, but they can still be wrong. You are responsible
        for what is sent in your name, which is why every reply waits for your approval unless you turn on Pro
        auto-reply. Declines and anything mentioning pricing always wait.
      </p>

      <h2>Billing</h2>
      <p>
        Stripe runs in test mode. No real payments are taken and the Pro plan is not a paid service. If that ever
        changes, these terms will change first.
      </p>

      <h2>Code and content</h2>
      <p>
        The source code is published on{" "}
        <a href={links.repo} className={textLink}>
          GitHub
        </a>{" "}
        under the licence in that repository. People, companies and figures in the product examples are synthetic.
      </p>

      <h2>Changes</h2>
      <p>
        These terms may change as the project changes; the date at the top shows the last edit. How data is handled is
        described on the <Link href={links.privacy} className={textLink}>privacy page</Link>.
      </p>
    </LegalPage>
  );
}
