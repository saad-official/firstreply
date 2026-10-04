import { MockCard, Pill } from "./parts";

const queue = [
  {
    who: "Priya Raman",
    org: "Lumen Clinics",
    what: "Reply with three slots",
    score: "84",
    conf: "0.86",
    status: { tone: "sea" as const, text: "Can auto-send on Pro" },
  },
  {
    who: "Tom Becker",
    org: "Kestrel Physio",
    what: "Answer: “what does it cost?”",
    score: "77",
    conf: "0.91",
    status: { tone: "lemon" as const, text: "Mentions pricing · waits" },
  },
  {
    who: "Dana Wu",
    org: "Brightside Agency",
    what: "Polite decline, one resource link",
    score: "31",
    conf: "0.88",
    status: { tone: "lemon" as const, text: "Decline · waits" },
  },
];

/** The approval queue, with the Pro rule spelled out above it. */
export function AutonomyMock() {
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-dashed border-foreground/30 bg-card px-4 py-3.5">
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone="night">Pro</Pill>
          <span className="text-xs font-semibold text-foreground/75">Auto-reply rule</span>
        </div>
        <p className="stopwatch mt-2.5 text-sm leading-relaxed">
          send if score ≥ 70 and confidence ≥ 0.8
          <br />
          <span className="text-foreground/75">never: declines, anything about pricing</span>
        </p>
      </div>
      <MockCard label="Approval queue" meta="3 waiting">
        <ul className="-my-1 divide-y divide-border">
          {queue.map((q) => (
            <li key={q.who} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-semibold">
                  {q.who} <span className="font-normal text-foreground/75">· {q.org}</span>
                </p>
                <p className="text-sm text-foreground/80">{q.what}</p>
                <p className="stopwatch mt-0.5 text-xs text-foreground/70">
                  score {q.score} · conf {q.conf}
                </p>
              </div>
              <Pill tone={q.status.tone} className="self-start sm:self-center">
                {q.status.text}
              </Pill>
            </li>
          ))}
        </ul>
      </MockCard>
    </div>
  );
}
