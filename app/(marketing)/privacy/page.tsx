import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/marketing/legal-page";
import { links, textLink } from "@/components/marketing/site";

export const metadata: Metadata = {
  title: "Privacy",
  description:
    "What the Firstreply demo stores, what it sends to model providers, what enrichment reads, and what it never does.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <LegalPage label="Privacy" title="What the demo keeps, and why" updated="2026-10-04">
      <h2>The short version</h2>
      <ul>
        <li>Firstreply is a portfolio demo. Please use the synthetic demo leads, not real people&rsquo;s details.</li>
        <li>It only processes leads that were sent to it. It never contacts anyone who did not write first.</li>
        <li>It does not sell data, show ads, or train models on what you enter.</li>
      </ul>

      <h2>What is stored</h2>
      <p>
        For your account: your name, email address, organisation name, and a session cookie that keeps you signed in.
        For your workspace: your rubric, voice and offer text, availability rules, forms and webhook tokens.
      </p>
      <p>
        For each lead: the fields sent with it (name, email, company, message and any custom fields), the summary
        enrichment produced, the score and its reasons, the message thread, offered slots and any meeting booked.
        Everything is scoped to your organisation in the app&rsquo;s Postgres database.
      </p>

      <h2>What enrichment reads</h2>
      <p>
        When a lead arrives from a company email address, Firstreply fetches that company&rsquo;s public homepage,
        without running scripts, with an eight-second limit, and only where robots.txt allows. It keeps the page
        title, description, headings and a short text excerpt. Free-mail domains such as Gmail are skipped. It does not
        look up people on social networks or buy data from brokers.
      </p>

      <h2>Model providers</h2>
      <p>
        Scoring, drafting and reply reading send the lead&rsquo;s message, the enrichment summary and your workspace
        settings to a hosted language model (Groq, with Google Gemini as a fallback). Free tiers of these services may
        use inputs to improve their products, which is one reason the demo asks for synthetic data only. Every call is
        logged in your workspace with the model, prompt version, token counts and time taken.
      </p>

      <h2>Email</h2>
      <p>
        By default outgoing email goes to an in-app outbox and is not delivered. Where delivery is switched on, mail is
        sent through Resend. Inbound replies in the demo are pasted into the Demo Inbox or simulated, and simulated
        replies are labelled as such.
      </p>

      <h2>Payments and analytics</h2>
      <p>
        Billing uses Stripe in test mode, so no real card data reaches this app and no money moves. The site uses
        Vercel Analytics for aggregate page views, without advertising cookies.
      </p>

      <h2>Deleting your data</h2>
      <p>
        To have your account and workspace removed, open an issue on the{" "}
        <a href={links.repo} className={textLink}>
          GitHub repository
        </a>{" "}
        and it will be deleted. See also the <Link href={links.terms} className={textLink}>terms</Link>.
      </p>
    </LegalPage>
  );
}
