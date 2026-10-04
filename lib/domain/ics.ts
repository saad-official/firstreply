/**
 * Minimal RFC 5545 calendar invite for a booked meeting (spec 3.3: the
 * confirmation email carries an ICS attachment). Times are UTC ("Z" form) so
 * no VTIMEZONE block is needed; lines use CRLF and fold at 75 octets.
 */

export interface IcsEvent {
  /** Stable per meeting (meetings.ics_uid); reuse it for updates/cancellations. */
  uid: string;
  start: Date;
  end: Date;
  summary: string;
  description: string;
  organizerEmail: string;
  attendeeEmail: string;
  location?: string;
  organizerName?: string;
  attendeeName?: string;
  /** DTSTAMP: when this invite was generated (injected for purity). */
  now: Date;
}

const MAX_LINE_OCTETS = 75;
const CRLF = "\r\n";
const encoder = new TextEncoder();

/** RFC 5545 3.3.11 TEXT escaping. */
export function escapeIcsText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/**
 * Fold a content line so no physical line exceeds 75 octets (RFC 5545 3.1).
 * Continuation lines start with one space, which counts toward their 75.
 * Splits only between code points, never inside a UTF-8 sequence.
 */
export function foldIcsLine(line: string): string {
  if (encoder.encode(line).length <= MAX_LINE_OCTETS) return line;
  const out: string[] = [];
  let current = "";
  let currentBytes = 0;
  for (const char of line) {
    const size = encoder.encode(char).length;
    const limit = out.length === 0 ? MAX_LINE_OCTETS : MAX_LINE_OCTETS - 1;
    if (currentBytes + size > limit) {
      out.push(current);
      current = "";
      currentBytes = 0;
    }
    current += char;
    currentBytes += size;
  }
  out.push(current);
  return out.join(`${CRLF} `);
}

/** "20261007T140000Z" (seconds kept, milliseconds dropped). */
function formatUtc(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z").replace(/[-:]/g, "");
}

function assertSingleLine(label: string, value: string): void {
  if (/[\r\n]/.test(value)) throw new RangeError(`${label} must not contain line breaks`);
}

/** Quoted CN parameter value; DQUOTE is not allowed inside (RFC 5545 3.2). */
function cn(name: string | undefined): string {
  const clean = name?.replace(/["\r\n]/g, "").replace(/\s+/g, " ").trim();
  return clean ? `;CN="${clean}"` : "";
}

export function buildIcs(event: IcsEvent): string {
  if (!(event.end.getTime() > event.start.getTime())) throw new RangeError("ICS event end must be after start");
  assertSingleLine("uid", event.uid);
  assertSingleLine("organizerEmail", event.organizerEmail);
  assertSingleLine("attendeeEmail", event.attendeeEmail);

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Firstreply//Booking//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${event.uid}`,
    `DTSTAMP:${formatUtc(event.now)}`,
    `DTSTART:${formatUtc(event.start)}`,
    `DTEND:${formatUtc(event.end)}`,
    `SUMMARY:${escapeIcsText(event.summary)}`,
    `DESCRIPTION:${escapeIcsText(event.description)}`,
    ...(event.location ? [`LOCATION:${escapeIcsText(event.location)}`] : []),
    `ORGANIZER${cn(event.organizerName)}:mailto:${event.organizerEmail}`,
    `ATTENDEE${cn(event.attendeeName)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${event.attendeeEmail}`,
    "SEQUENCE:0",
    "STATUS:CONFIRMED",
    "TRANSP:OPAQUE",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(foldIcsLine).join(CRLF) + CRLF;
}
