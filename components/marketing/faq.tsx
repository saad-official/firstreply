import { cn } from "@/lib/utils";
import { focusRing } from "./site";

const items: { q: string; a: React.ReactNode }[] = [
  {
    q: "Does it email people who didn’t contact us?",
    a: (
      <p>
        No. Firstreply only answers people who wrote to you first, through your form, your webhook or a forwarded
        email. There is no way to import a list or start a conversation, and it never cold-emails anyone.
      </p>
    ),
  },
  {
    q: "What if none of the slots work?",
    a: (
      <p>
        Most people say so in a sentence: &ldquo;Tuesday doesn&rsquo;t work, Thursday afternoon?&rdquo; Firstreply
        reads the reply, checks the time they proposed against your availability, and books it if it is free. If it
        isn&rsquo;t, it drafts a counter with two nearby times for you to approve. Every reply also carries your
        booking page link, so they can pick any open time themselves.
      </p>
    ),
  },
  {
    q: "Can it book straight into Google Calendar?",
    a: (
      <p>
        Not yet. Today it books against built-in availability (your days, hours, meeting length, buffer and notice)
        and sends a confirmation with an .ics invite that any calendar accepts. Google Calendar sync, including your
        busy times, is next.
      </p>
    ),
  },
  {
    q: "What about spam?",
    a: (
      <p>
        The hosted form has a hidden honeypot field; anything that fills it is marked spam and archived without a
        reply. The scorer can also mark a lead as spam, and those are archived the same way. You can still see them on
        the leads board.
      </p>
    ),
  },
  {
    q: "Where does the reply come from?",
    a: (
      <>
        <p>
          A language model drafts it from the lead&rsquo;s message, a short summary of their public website, the score
          reasons, and the voice and offer you set. Rules then check the draft: all three slots and the booking link
          word for word, no pricing promises, nothing about their company beyond what their website says, 60 to 180
          words, and a sign-off.
        </p>
        <p>
          A draft that fails a check waits for you instead of sending. Every model call is logged with the model,
          prompt version, tokens and time taken.
        </p>
      </>
    ),
  },
];

/** Native disclosure list: works without JavaScript and with find-in-page. */
export function Faq({ headingLevel = "h3" }: { headingLevel?: "h2" | "h3" }) {
  const Heading = headingLevel;
  return (
    <div className="border-t border-border">
      {items.map((item) => (
        <details key={item.q} className="group border-b border-border">
          <summary
            className={cn(
              "flex cursor-pointer list-none items-start justify-between gap-6 py-5 [&::-webkit-details-marker]:hidden",
              focusRing,
            )}
          >
            <Heading className="text-lg leading-snug font-semibold sm:text-xl">{item.q}</Heading>
            <span
              aria-hidden="true"
              className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-foreground/[0.06] font-mono text-base leading-none group-open:bg-foreground group-open:text-background"
            >
              <span className="group-open:hidden">+</span>
              <span className="hidden group-open:inline">&minus;</span>
            </span>
          </summary>
          <div className="max-w-2xl space-y-3 pb-6 text-[0.9375rem] leading-relaxed text-foreground/85">{item.a}</div>
        </details>
      ))}
    </div>
  );
}
