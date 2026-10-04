import { describe, expect, it } from "vitest";
import { detectProvider, normalizeWebhookPayload } from "@/lib/domain/adapters";
import {
  framerHeaders,
  framerPayload,
  hostedFormPayload,
  tallyPayload,
  typeformPayload,
  webflowLegacyPayload,
  webflowPayload,
} from "./fixtures/webhooks";

const JSON_HEADERS = { "content-type": "application/json" };

describe("normalizeWebhookPayload: Typeform", () => {
  it("maps answers by field ref and title, with choices and hidden fields as custom fields", () => {
    expect(normalizeWebhookPayload(typeformPayload, { "Typeform-Signature": "sha256=abc" })).toEqual({
      source: "typeform",
      name: "Maya Patel",
      email: "maya@northwind.example",
      company: "Northwind Analytics",
      message: "We are a 40-person SaaS team and need help rebuilding our onboarding flow before Q1.",
      customFields: {
        "Budget range": "$10k-$25k",
        "Which services?": "UX research, Onboarding",
        "Subscribe to our newsletter?": "false",
        utm_source: "linkedin",
      },
    });
  });

  it("returns null when no answer carries an email", () => {
    const answers = typeformPayload.form_response.answers.filter((a) => a.type !== "email");
    const body = { ...typeformPayload, form_response: { ...typeformPayload.form_response, answers } };
    expect(normalizeWebhookPayload(body, {})).toBeNull();
  });
});

describe("normalizeWebhookPayload: Tally", () => {
  it("maps fields by label, resolving choice option ids to text", () => {
    expect(normalizeWebhookPayload(tallyPayload, JSON_HEADERS)).toEqual({
      source: "tally",
      name: "Tom Becker",
      email: "tom@kestrel-legal.example",
      company: "Kestrel Legal",
      message: "Intake forms for a 12-lawyer firm; we lose leads after hours.",
      customFields: { "Team size": "11-50" },
    });
  });
});

describe("normalizeWebhookPayload: Webflow", () => {
  it("maps a v2 form_submission, joining first and last name", () => {
    expect(normalizeWebhookPayload(webflowPayload, JSON_HEADERS)).toEqual({
      source: "webflow",
      name: "Ana Souza",
      email: "ana@lumen-clinics.example",
      company: "Lumen Clinics",
      message: "We run three physio clinics and want online booking for new patients.",
      customFields: { Phone: "+44 20 7946 0000" },
    });
  });

  it("maps the legacy v1 shape", () => {
    expect(normalizeWebhookPayload(webflowLegacyPayload, JSON_HEADERS)).toEqual({
      source: "webflow",
      name: "Ravi Kumar",
      email: "ravi@orbit.example",
      message: "Looking for a website refresh in November.",
    });
  });
});

describe("normalizeWebhookPayload: Framer", () => {
  it("maps a flat body identified by Framer headers", () => {
    expect(normalizeWebhookPayload(framerPayload, framerHeaders)).toEqual({
      source: "framer",
      name: "Lena Fischer",
      email: "lena@alpenrose.example",
      company: "Alpenrose Hotels",
      message: "Booking-engine redesign for 4 boutique hotels, launch in spring.",
    });
  });

  it("also accepts the fields nested under data", () => {
    expect(normalizeWebhookPayload({ data: framerPayload }, framerHeaders)?.email).toBe("lena@alpenrose.example");
  });
});

describe("normalizeWebhookPayload: hosted form", () => {
  it("maps our own field names, custom fields and time zone", () => {
    expect(normalizeWebhookPayload(hostedFormPayload, JSON_HEADERS, { honeypotField: "website" })).toEqual({
      source: "form",
      name: "Jordan Lee",
      email: "jordan@harborline.example",
      company: "Harborline Logistics",
      message: "Need a customer portal for 200 shipping clients, starting next month.",
      customFields: { budget: "25-50k", "Team size": "51-200" },
      leadTimezone: "America/Chicago",
      honeypotFilled: false,
    });
  });

  it("flags a filled honeypot", () => {
    const body = { ...hostedFormPayload, website: "http://cheap-seo.example" };
    expect(normalizeWebhookPayload(body, JSON_HEADERS, { honeypotField: "website" })?.honeypotFilled).toBe(true);
  });

  it("drops an invalid time zone instead of rejecting the lead", () => {
    const lead = normalizeWebhookPayload({ ...hostedFormPayload, timezone: "Mars/Olympus" }, JSON_HEADERS);
    expect(lead?.leadTimezone).toBeUndefined();
    expect(lead?.email).toBe("jordan@harborline.example");
  });
});

describe("normalizeWebhookPayload: generic flat bodies", () => {
  it("maps a flat JSON object by key vocabulary", () => {
    const body = {
      full_name: "Priya Shah",
      emailAddress: "priya@cobalt.example",
      organisation: "Cobalt Dental",
      comments: "Two clinics, want automated replies to web enquiries.",
      phone: "+1 415 555 0100",
      _gotcha: "",
      "g-recaptcha-response": "03AFcWeA...",
    };
    expect(normalizeWebhookPayload(body, JSON_HEADERS)).toEqual({
      source: "webhook",
      name: "Priya Shah",
      email: "priya@cobalt.example",
      company: "Cobalt Dental",
      message: "Two clinics, want automated replies to web enquiries.",
      customFields: { phone: "+1 415 555 0100" },
    });
  });

  it("finds the first email-like value when no key mentions email", () => {
    const body = { who: "Sam", contact: "sam@quill.example", msg: "Can you help us with a rebrand this quarter?" };
    expect(normalizeWebhookPayload(body, {})).toEqual({
      source: "webhook",
      email: "sam@quill.example",
      message: "Can you help us with a rebrand this quarter?",
      customFields: { who: "Sam" },
    });
  });

  it("falls back to the longest free-text value as the message", () => {
    const body = { email: "kai@fern.example", q1: "Yes", q2: "We need a new booking flow for our yoga studios in Berlin." };
    expect(normalizeWebhookPayload(body, {})).toMatchObject({
      message: "We need a new booking flow for our yoga studios in Berlin.",
      customFields: { q1: "Yes" },
    });
  });

  it("does not take a long 'about your business' answer as the company name", () => {
    const body = {
      email: "noor@sable.example",
      "Tell us about your business": "We are a family-run bakery chain with six shops and a growing catering arm.",
    };
    const lead = normalizeWebhookPayload(body, {});
    expect(lead?.company).toBeUndefined();
    expect(lead?.message).toBe("We are a family-run bakery chain with six shops and a growing catering arm.");
  });

  it("parses an urlencoded string body", () => {
    const body = "name=Lee+Chen&email=lee%40harbor.example&company=Harbor+%26+Co&message=Need+a+quote+for+3+sites";
    expect(normalizeWebhookPayload(body, { "Content-Type": "application/x-www-form-urlencoded" })).toEqual({
      source: "webhook",
      name: "Lee Chen",
      email: "lee@harbor.example",
      company: "Harbor & Co",
      message: "Need a quote for 3 sites",
    });
  });

  it("accepts URLSearchParams and JSON strings", () => {
    const params = new URLSearchParams({ email: "a@b.example", message: "hello" });
    expect(normalizeWebhookPayload(params, {})?.email).toBe("a@b.example");
    expect(normalizeWebhookPayload(JSON.stringify({ email: "c@d.example" }), JSON_HEADERS)).toEqual({
      source: "webhook",
      email: "c@d.example",
      message: "",
    });
  });

  it.each([null, undefined, 42, "", "not a form", [], [{ email: "a@b.example" }], {}, { email: "not-an-email" }])(
    "returns null for %j",
    (body) => {
      expect(normalizeWebhookPayload(body, {})).toBeNull();
    },
  );

  it("caps very long values so a hostile payload cannot bloat the lead", () => {
    const lead = normalizeWebhookPayload({ email: "a@b.example", message: "x ".repeat(20_000) }, {});
    expect(lead?.message.length).toBeLessThanOrEqual(10_000);
  });
});

describe("detectProvider", () => {
  it("identifies each shape", () => {
    expect(detectProvider(typeformPayload, {})).toBe("typeform");
    expect(detectProvider(tallyPayload, {})).toBe("tally");
    expect(detectProvider(webflowPayload, {})).toBe("webflow");
    expect(detectProvider(webflowLegacyPayload, {})).toBe("webflow");
    expect(detectProvider(framerPayload, { "framer-signature": "x" })).toBe("framer");
    expect(detectProvider(hostedFormPayload, {})).toBe("form");
    expect(detectProvider({ email: "a@b.example" }, { "x-firstreply-form": "brightpath" })).toBe("form");
    expect(detectProvider({ email: "a@b.example" }, {})).toBe("webhook");
  });
});
