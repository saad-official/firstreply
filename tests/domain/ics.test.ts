import { describe, expect, it } from "vitest";
import { buildIcs, escapeIcsText, foldIcsLine, type IcsEvent } from "@/lib/domain/ics";

const event: IcsEvent = {
  uid: "mtg_01HZX@firstreply.app",
  start: new Date("2026-10-07T14:00:00.000Z"),
  end: new Date("2026-10-07T14:30:00.000Z"),
  summary: "Intro call: Brightpath Studio x Northwind",
  description: "20-minute intro call.\nAgenda: goals, timeline; next steps.",
  organizerEmail: "sam@brightpath.example",
  attendeeEmail: "maya@northwind.example",
  now: new Date("2026-10-05T12:00:30.250Z"),
};

const bytes = (s: string) => new TextEncoder().encode(s).length;
const unfold = (ics: string) => ics.replace(/\r\n[ \t]/g, "");
const lines = (ics: string) => unfold(ics).split("\r\n");

describe("buildIcs", () => {
  const ics = buildIcs(event);

  it("wraps one VEVENT in a VCALENDAR with METHOD:REQUEST", () => {
    expect(lines(ics)).toEqual([
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Firstreply//Booking//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:REQUEST",
      "BEGIN:VEVENT",
      "UID:mtg_01HZX@firstreply.app",
      "DTSTAMP:20261005T120030Z",
      "DTSTART:20261007T140000Z",
      "DTEND:20261007T143000Z",
      "SUMMARY:Intro call: Brightpath Studio x Northwind",
      "DESCRIPTION:20-minute intro call.\\nAgenda: goals\\, timeline\\; next steps.",
      "ORGANIZER:mailto:sam@brightpath.example",
      "ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:maya@northwind.example",
      "SEQUENCE:0",
      "STATUS:CONFIRMED",
      "TRANSP:OPAQUE",
      "END:VEVENT",
      "END:VCALENDAR",
      "",
    ]);
  });

  it("uses CRLF line endings throughout, with a trailing CRLF", () => {
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
  });

  it("adds LOCATION and CN parameters when given", () => {
    const withExtras = lines(
      buildIcs({ ...event, location: "Google Meet", organizerName: "Sam Rivera", attendeeName: 'Maya "MP" Patel' }),
    );
    expect(withExtras).toContain("LOCATION:Google Meet");
    expect(withExtras).toContain('ORGANIZER;CN="Sam Rivera":mailto:sam@brightpath.example');
    expect(withExtras).toContain(
      'ATTENDEE;CN="Maya MP Patel";ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:maya@northwind.example',
    );
  });

  it("omits LOCATION when absent", () => {
    expect(ics).not.toContain("LOCATION");
  });

  it("folds long lines at 75 octets and unfolds back to the original", () => {
    const description = "Notes from the form: ".concat("We want to rebuild onboarding. ".repeat(12)).trim();
    const out = buildIcs({ ...event, description });
    for (const line of out.split("\r\n")) expect(bytes(line)).toBeLessThanOrEqual(75);
    expect(lines(out)).toContain(`DESCRIPTION:${description}`);
    expect(out).toMatch(/\r\n [^\r\n]/);
  });

  it("never splits a multi-byte UTF-8 character when folding", () => {
    const description = "Café résumé — 会議の予定 🚀 ".repeat(8).trim();
    const out = buildIcs({ ...event, description });
    for (const line of out.split("\r\n")) {
      expect(bytes(line)).toBeLessThanOrEqual(75);
      expect(line).not.toMatch(/�/);
    }
    expect(lines(out)).toContain(`DESCRIPTION:${description}`);
  });

  it("rejects an end that is not after the start", () => {
    expect(() => buildIcs({ ...event, end: event.start })).toThrow(RangeError);
  });

  it("rejects line breaks in the UID and email addresses", () => {
    expect(() => buildIcs({ ...event, uid: "a\r\nX-INJECT:1" })).toThrow(RangeError);
    expect(() => buildIcs({ ...event, attendeeEmail: "a@b.co\nX:1" })).toThrow(RangeError);
  });
});

describe("escapeIcsText", () => {
  it("escapes backslash, semicolon, comma and newlines (RFC 5545 3.3.11)", () => {
    expect(escapeIcsText("a\\b;c,d\r\ne\nf")).toBe("a\\\\b\\;c\\,d\\ne\\nf");
  });
});

describe("foldIcsLine", () => {
  it("leaves short lines alone", () => {
    expect(foldIcsLine("SUMMARY:short")).toBe("SUMMARY:short");
  });

  it("folds exactly at 75 octets, continuation lines starting with a space", () => {
    const line = `X:${"a".repeat(200)}`;
    const folded = foldIcsLine(line).split("\r\n");
    expect(folded[0]).toHaveLength(75);
    expect(folded.slice(1).every((l) => l.startsWith(" ") && bytes(l) <= 75)).toBe(true);
    expect(folded.join("\r\n").replace(/\r\n /g, "")).toBe(line);
  });
});
