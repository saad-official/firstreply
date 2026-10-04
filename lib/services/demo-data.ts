/**
 * Synthetic demo content (spec 3.7). Every company, person and address is
 * fictional: domains use the reserved `.example` TLD, which can never belong
 * to anyone, and each homepage says it is a demo fixture.
 */

function page(title: string, description: string, headings: string[], paragraphs: string[]): string {
  return `<!doctype html><html><head><title>${title}</title><meta name="description" content="${description}"></head><body>${headings
    .map((h, i) => `<h${i === 0 ? 1 : 2}>${h}</h${i === 0 ? 1 : 2}>`)
    .join("")}${paragraphs.map((p) => `<p>${p}</p>`).join("")}<footer>Fictional company used in the Firstreply demo.</footer></body></html>`;
}

/** Built-in homepages for the demo domains, so enrichment works offline. */
export const DEMO_SITES: Record<string, string> = {
  "lumenfreight.example": page(
    "Lumen Freight | Freight visibility software for mid-size shippers",
    "Lumen Freight gives logistics teams one live view of every shipment. 60 people, Manchester and Rotterdam.",
    ["Every shipment, one screen", "Built for shippers with 20 to 500 lanes", "Series A, 2025"],
    [
      "Lumen Freight is a B2B software company helping mid-size shippers track loads across carriers in real time.",
      "Our team of 60 works from Manchester and Rotterdam. We are hiring across product and marketing.",
    ],
  ),
  "brightloop.example": page(
    "Brightloop Accounting | Bookkeeping for small studios",
    "An eight-person accounting practice for creative studios in Berlin.",
    ["Bookkeeping that speaks studio", "Monthly close, quarterly advice"],
    ["Brightloop looks after the books of about 120 creative studios and freelancers across Germany."],
  ),
  "quillandoak.example": page(
    "Quill & Oak | Handmade furniture from Bristol",
    "Small-batch oak furniture, made to order in our Bristol workshop since 2019.",
    ["Made slowly, built to last", "Commissions open for spring"],
    ["We are a team of five makers. Every table, bench and shelf is made to order from English oak."],
  ),
  "rankrocket.example": page(
    "Rank Rocket | Guaranteed page one rankings",
    "Backlinks, guest posts and SEO packages. Page one of Google guaranteed.",
    ["Get to page one in 30 days", "Packages from 99"],
    ["We contact thousands of websites every week to offer link-building packages."],
  ),
  "harbourlight.example": page(
    "Harbourlight Clinics | Physiotherapy in Leeds and York",
    "Four physiotherapy clinics with 40 clinicians, opening two more in 2027.",
    ["Physio that fits around you", "Book online in two minutes"],
    ["Harbourlight runs four clinics across Yorkshire and is planning a new patient booking site for 2027."],
  ),
};

export const DEMO_RUBRIC = `We are a small design studio. Good fit: B2B companies with 10 to 200 people in the UK or EU planning a website, rebrand or product design project in the next six months. Strong signals: a named company, a clear brief, a timeline or launch date, a decision maker writing.
Not a fit: individuals wanting free or unpaid work, students, very small one-off jobs like a single logo, agencies looking to resell our work, and anyone selling SEO, link building or lead lists to us.`;

export const DEMO_OFFER = "a 30-minute intro call to talk through your project";

export const DEMO_VOICE = {
  tone: "warm, direct, plain English, no jargon",
  senderName: "Robin",
  notes: "Use British spelling. Keep it short.",
  declineResourceUrl: "https://www.gov.uk/business-support-helpline",
};

export type DemoLead = {
  key: string;
  name: string;
  email: string;
  company?: string;
  message: string;
  leadTimezone: string;
  /** Created this many minutes before seeding. */
  minutesAgo: number;
};

/** Six leads of varied quality (spec 3.7, shortened from 12 so processing stays well inside a minute). */
export const DEMO_LEADS: DemoLead[] = [
  {
    key: "high-fit",
    name: "Maya Okafor",
    email: "maya.okafor@lumenfreight.example",
    company: "Lumen Freight",
    message:
      "Hi! I lead marketing at Lumen Freight, a 60-person freight software company. Our website has not changed since our Series A and no longer explains what we do. We would like a redesign and new messaging before our product launch in January. Could we talk next week about scope and timeline?",
    leadTimezone: "Europe/London",
    minutesAgo: 3,
  },
  {
    key: "pricing",
    name: "Ana Lima",
    email: "ana@quillandoak.example",
    company: "Quill & Oak",
    message:
      "Hello, we make oak furniture in Bristol and need a new five-page website with a small shop and a journal. We would like it live by spring. How much do you usually charge for something like this, and what are your rates for ongoing updates?",
    leadTimezone: "Europe/London",
    minutesAgo: 11,
  },
  {
    key: "medium",
    name: "Jonas Becker",
    email: "jonas.becker@brightloop.example",
    company: "Brightloop Accounting",
    message:
      "We are an eight-person accounting practice and want to refresh our logo and website at some point next quarter. Nothing urgent yet, just collecting options.",
    leadTimezone: "Europe/Berlin",
    minutesAgo: 26,
  },
  {
    key: "spam",
    name: "Growth Team",
    email: "growth@rankrocket.example",
    company: "Rank Rocket",
    message:
      "Dear Sir/Madam, we can put your website on the first page of Google with our guaranteed SEO backlinks package. Reply YES for our price list.",
    leadTimezone: "UTC",
    minutesAgo: 47,
  },
  {
    key: "low-fit",
    name: "Sam Patel",
    email: "sam.patel@campusmail.example",
    message:
      "Hi, I am a design student and need a logo for my school project. Could you make one for free? It would really help my portfolio.",
    leadTimezone: "Europe/London",
    minutesAgo: 95,
  },
  {
    key: "out-of-office",
    name: "Priya Nair",
    email: "priya.nair@harbourlight.example",
    company: "Harbourlight Clinics",
    message:
      "We run four physio clinics and are planning a new patient booking website for next year. We would like a partner for discovery and design. Is this something you take on?",
    leadTimezone: "Europe/London",
    minutesAgo: 2 * 24 * 60,
  },
];

/** The out-of-office lead already has a sent reply and an automatic reply back (seeded thread). */
export const DEMO_OOO_KEY = "out-of-office";
export const DEMO_FIRST_REPLY_SECONDS = 42;
export const DEMO_OOO_REPLY = (returnDate: string) =>
  `Automatic reply: Thank you for your email. I am out of the office until ${returnDate} with limited access to email. For anything urgent, please write to team@harbourlight.example.`;
