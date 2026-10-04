import { CopyField } from "./copy-button";

/**
 * Where to paste the endpoint in each provider. Menu names as of Oct 2026;
 * providers rename things, so the steps stay short and describe the area.
 */
const PROVIDERS = [
  {
    name: "Typeform",
    steps: [
      "Open the form, then Connect → Webhooks.",
      "Add a webhook, paste the endpoint URL and save.",
      "Switch the webhook on and use “View deliveries” to send a test.",
    ],
  },
  {
    name: "Tally",
    steps: [
      "Open the form, then Integrations → Webhooks → Connect.",
      "Paste the endpoint URL as the Endpoint URL and connect.",
      "Submit the form once to check the lead arrives.",
    ],
  },
  {
    name: "Webflow",
    steps: [
      "Site settings → Apps & integrations → Webhooks → Add webhook.",
      "Trigger type: Form submission. Paste the endpoint URL.",
      "Publish the site; each form submission is sent here.",
    ],
  },
  {
    name: "Framer",
    steps: [
      "Select the form on the canvas; in the right panel find Send To.",
      "Choose Webhook and paste the endpoint URL.",
      "Publish, then submit the live form once to test.",
    ],
  },
] as const;

export function WebhookGuides({ endpoint }: { endpoint: string | null }) {
  const target = endpoint ?? "https://<your-endpoint>";
  const curl = `curl -X POST ${target} -H 'content-type: application/json' -d '{"email":"maya@lumenfreight.example","name":"Maya Okafor","company":"Lumen Freight","message":"We need a new website before January."}'`;

  return (
    <div className="grid gap-5">
      <div className="grid gap-1">
        <h3 className="font-heading text-lg">Connect your form tool</h3>
        <p className="text-sm text-muted-foreground">
          Any JSON or form-encoded POST with an <span className="font-mono text-foreground">email</span> field becomes a
          lead. Name, company and message are picked up from common field names.
        </p>
      </div>
      <ol className="grid gap-3 sm:grid-cols-2">
        {PROVIDERS.map((p, index) => (
          <li key={p.name} className="rounded-xl bg-muted/50 p-4 ring-1 ring-foreground/5">
            <h4 className="flex items-center gap-2 text-sm font-semibold">
              <span
                aria-hidden
                className="stopwatch grid size-5 place-items-center rounded-full bg-foreground text-[0.65rem] text-background"
              >
                {index + 1}
              </span>
              {p.name}
            </h4>
            <ol className="mt-2 grid list-decimal gap-1 pl-5 text-sm text-foreground/85 marker:text-muted-foreground">
              {p.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </li>
        ))}
      </ol>

      <div className="grid gap-1.5">
        <h4 className="text-sm font-semibold">Test it from a terminal</h4>
        <p className="text-sm text-muted-foreground">
          {endpoint
            ? "Sends a sample lead to your first active endpoint. It counts towards this month's leads."
            : "Create an endpoint above and this example fills in its URL."}
        </p>
        <CopyField value={curl} label="Copy curl example" multiline />
      </div>
    </div>
  );
}
