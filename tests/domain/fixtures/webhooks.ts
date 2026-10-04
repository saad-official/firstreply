/**
 * Sample webhook payloads, written from memory of each provider's documented
 * shape (October 2026). They are APPROXIMATIONS: field ids, tokens and some
 * metadata keys are invented. Replace with captured payloads when available.
 */

/** Typeform "form_response" webhook (answers keyed by field id/ref; titles in definition.fields). */
export const typeformPayload = {
  event_id: "01J9ZK3Q6W2T5Y8N4B7C1D0E9F",
  event_type: "form_response",
  form_response: {
    form_id: "lT4Z3j",
    token: "a3a12ec67a1365927098a606107fac15",
    landed_at: "2026-10-05T14:00:02Z",
    submitted_at: "2026-10-05T14:02:11Z",
    hidden: { utm_source: "linkedin" },
    definition: {
      id: "lT4Z3j",
      title: "Work with Brightpath",
      fields: [
        { id: "Q1nm", title: "What's your name?", type: "short_text", ref: "full_name" },
        { id: "Q2em", title: "And your work email?", type: "email", ref: "a8c9b3f0-1d2e-4f5a-9b8c-7d6e5f4a3b2c" },
        { id: "Q3co", title: "Which company are you with?", type: "short_text", ref: "company" },
        { id: "Q4ms", title: "How can we help?", type: "long_text", ref: "project_details" },
        { id: "Q5bd", title: "Budget range", type: "multiple_choice", ref: "budget" },
        { id: "Q6ch", title: "Which services?", type: "multiple_choice", ref: "services" },
        { id: "Q7nl", title: "Subscribe to our newsletter?", type: "yes_no", ref: "newsletter" },
      ],
    },
    answers: [
      { type: "text", text: "Maya Patel", field: { id: "Q1nm", type: "short_text", ref: "full_name" } },
      {
        type: "email",
        email: "Maya@Northwind.example",
        field: { id: "Q2em", type: "email", ref: "a8c9b3f0-1d2e-4f5a-9b8c-7d6e5f4a3b2c" },
      },
      { type: "text", text: "Northwind Analytics", field: { id: "Q3co", type: "short_text", ref: "company" } },
      {
        type: "text",
        text: "We are a 40-person SaaS team and need help rebuilding our onboarding flow before Q1.",
        field: { id: "Q4ms", type: "long_text", ref: "project_details" },
      },
      { type: "choice", choice: { label: "$10k-$25k" }, field: { id: "Q5bd", type: "multiple_choice", ref: "budget" } },
      {
        type: "choices",
        choices: { labels: ["UX research", "Onboarding"] },
        field: { id: "Q6ch", type: "multiple_choice", ref: "services" },
      },
      { type: "boolean", boolean: false, field: { id: "Q7nl", type: "yes_no", ref: "newsletter" } },
    ],
  },
};

/** Tally "FORM_RESPONSE" webhook (data.fields with label, type and value). */
export const tallyPayload = {
  eventId: "a4cb511e-d513-4fa5-baee-b815d718dfd1",
  eventType: "FORM_RESPONSE",
  createdAt: "2026-10-05T14:02:11.000Z",
  data: {
    responseId: "2wgx4n",
    submissionId: "2wgx4n",
    respondentId: "dwQKYm",
    formId: "VwbNEw",
    formName: "Work with us",
    createdAt: "2026-10-05T14:02:11.000Z",
    fields: [
      { key: "question_mVGEg3", label: "Your name", type: "INPUT_TEXT", value: "Tom Becker" },
      { key: "question_nPq7R1", label: "Email", type: "INPUT_EMAIL", value: "tom@kestrel-legal.example" },
      { key: "question_3EKz4n", label: "Firm", type: "INPUT_TEXT", value: "Kestrel Legal" },
      {
        key: "question_w4Q2xL",
        label: "What do you need?",
        type: "TEXTAREA",
        value: "Intake forms for a 12-lawyer firm; we lose leads after hours.",
      },
      {
        key: "question_7Ka1Pz",
        label: "Team size",
        type: "MULTIPLE_CHOICE",
        value: ["5f1c0b2e-1"],
        options: [
          { id: "5f1c0b2e-1", text: "11-50" },
          { id: "5f1c0b2e-2", text: "51-200" },
        ],
      },
      { key: "question_9Lm2Qa", label: "Anything else?", type: "TEXTAREA", value: null },
    ],
  },
};

/** Webflow v2 "form_submission" webhook (payload.data keyed by field name). */
export const webflowPayload = {
  triggerType: "form_submission",
  payload: {
    name: "Contact Form",
    siteId: "65427cf400e02b306eaa049c",
    data: {
      "First Name": "Ana",
      "Last Name": "Souza",
      "Email Address": "ana@lumen-clinics.example",
      "Company Name": "Lumen Clinics",
      Message: "We run three physio clinics and want online booking for new patients.",
      Phone: "+44 20 7946 0000",
    },
    submittedAt: "2026-10-05T14:02:11.000Z",
    id: "6321ca84df3949bfc6752327",
    formId: "65429eadebe8a9f3a30f62d0",
  },
};

/** Legacy Webflow (v1) form webhook: top-level name/site/data/d/_id. */
export const webflowLegacyPayload = {
  name: "Contact Form",
  site: "62749158efef318abc8d5a0f",
  data: { Name: "Ravi Kumar", Email: "ravi@orbit.example", Message: "Looking for a website refresh in November." },
  d: "2026-10-05T14:02:11.000Z",
  _id: "6274a1b2c3d4e5f6a7b8c9d0",
};

/** Framer form webhook: flat JSON keyed by field name, signed via headers. */
export const framerPayload = {
  Name: "Lena Fischer",
  Email: "lena@alpenrose.example",
  Company: "Alpenrose Hotels",
  "Tell us about your project": "Booking-engine redesign for 4 boutique hotels, launch in spring.",
};
export const framerHeaders = {
  "Framer-Webhook-Submission-Id": "f3d1c0b2-1111-4a5b-9c8d-123456789abc",
  "Framer-Signature": "sha256=0f1e2d3c4b5a69788796a5b4c3d2e1f0",
  "Content-Type": "application/json",
};

/** Our hosted form (/f/<slug>) posts these field names. */
export const hostedFormPayload = {
  formSlug: "brightpath",
  name: "Jordan Lee",
  email: "jordan@harborline.example",
  company: "Harborline Logistics",
  message: "Need a customer portal for 200 shipping clients, starting next month.",
  customFields: { budget: "25-50k", "Team size": "51-200" },
  timezone: "America/Chicago",
  website: "",
};
