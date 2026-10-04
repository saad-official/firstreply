import { describe, expect, it } from "vitest";
import {
  adjustScore,
  AUTO_REPLY_MIN_CONFIDENCE,
  AUTO_REPLY_MIN_SCORE,
  decideAction,
  fitFromScore,
  isFreeMailDomain,
  wordCount,
  type AdjustedScore,
} from "@/lib/domain/scoring";
import type { ScoreOutput } from "@/lib/domain/types";

const LONG_MESSAGE =
  "We are a 40-person B2B SaaS team in Leeds looking for help redesigning our onboarding before our Q1 launch.";

function model(overrides: Partial<ScoreOutput> = {}): ScoreOutput {
  return {
    score: 78,
    fit: "high",
    reasons: ["B2B SaaS", "UK based", "clear timeline"],
    summary: "Mid-size UK SaaS team with a concrete onboarding project.",
    confidence: 0.86,
    ...overrides,
  };
}

const companyLead = { email: "maya@northwind.example", message: LONG_MESSAGE };

describe("isFreeMailDomain", () => {
  it.each([
    "gmail.com",
    "googlemail.com",
    "yahoo.com",
    "yahoo.co.uk",
    "ymail.com",
    "hotmail.com",
    "hotmail.fr",
    "outlook.com",
    "live.co.uk",
    "msn.com",
    "icloud.com",
    "me.com",
    "aol.com",
    "proton.me",
    "protonmail.com",
    "pm.me",
    "gmx.de",
    "mail.com",
    "yandex.ru",
    "zoho.com",
    "GMAIL.COM",
    " @gmail.com ",
  ])("treats %j as free mail", (domain) => {
    expect(isFreeMailDomain(domain)).toBe(true);
  });

  it.each(["northwind.example", "gmail.co.example", "mygmail.com", "outlookconsulting.com", "acme.io", ""])(
    "treats %j as a company domain",
    (domain) => {
      expect(isFreeMailDomain(domain)).toBe(false);
    },
  );
});

describe("wordCount", () => {
  it("counts words, ignoring punctuation-only tokens", () => {
    expect(wordCount("  Hi -- can we talk?  ")).toBe(4);
    expect(wordCount("")).toBe(0);
    expect(wordCount("Need a quote for 3 sites, ASAP!")).toBe(7);
  });
});

describe("fitFromScore", () => {
  it.each([
    [100, "high"],
    [70, "high"],
    [69, "medium"],
    [40, "medium"],
    [39, "low"],
    [15, "low"],
    [14, "spam"],
    [0, "spam"],
  ] as const)("%i -> %s", (score, fit) => {
    expect(fitFromScore(score)).toBe(fit);
  });
});

describe("adjustScore", () => {
  it("passes a clean company lead through unchanged", () => {
    const result = adjustScore(model(), companyLead);
    expect(result).toEqual({
      ...model(),
      modelScore: 78,
      modelFit: "high",
      adjustments: [],
    });
  });

  it("subtracts 10 for a free-mail domain and records why", () => {
    const result = adjustScore(model(), { ...companyLead, email: "maya.patel@gmail.com" });
    expect(result.score).toBe(68);
    expect(result.fit).toBe("high"); // one band away: the model's fit stands
    expect(result.adjustments).toEqual([
      { code: "free_mail", delta: -10, note: "Free-mail address (gmail.com): -10" },
    ]);
  });

  it("subtracts 10 for a message under 10 words", () => {
    const result = adjustScore(model(), { ...companyLead, message: "Call me back please." });
    expect(result.score).toBe(68);
    expect(result.adjustments.map((a) => a.code)).toEqual(["short_message"]);
  });

  it("does not penalise a message of exactly 10 words", () => {
    const tenWords = "one two three four five six seven eight nine ten";
    expect(adjustScore(model(), { ...companyLead, message: tenWords }).adjustments).toEqual([]);
  });

  it("stacks both penalties", () => {
    const result = adjustScore(model({ score: 55, fit: "medium" }), { email: "x@yahoo.com", message: "pricing?" });
    expect(result.score).toBe(35);
    expect(result.fit).toBe("medium");
    expect(result.adjustments.map((a) => a.code)).toEqual(["free_mail", "short_message"]);
  });

  it("clamps at 0", () => {
    const result = adjustScore(model({ score: 12, fit: "spam" }), { email: "x@gmail.com", message: "hi" });
    expect(result.score).toBe(0);
    expect(result.fit).toBe("spam");
  });

  it("clamps an out-of-range model score into 0..100 and notes it", () => {
    const result = adjustScore(model({ score: 140 }), companyLead);
    expect(result.score).toBe(100);
    expect(result.adjustments).toEqual([{ code: "clamped", delta: -40, note: "Score clamped to 0..100" }]);
  });

  it("re-derives fit from the score when the model's fit is more than one band away", () => {
    // Model says high, but the adjusted score (28) is in the low band: two bands apart.
    const result = adjustScore(model({ score: 48, fit: "high" }), { email: "x@gmail.com", message: "hello there" });
    expect(result.score).toBe(28);
    expect(result.fit).toBe("low");
    expect(result.adjustments.at(-1)).toEqual({
      code: "fit_rederived",
      delta: 0,
      note: 'Model fit "high" disagreed with score 28; fit set to "low"',
    });
  });

  it("re-derives a model 'spam' with a high score", () => {
    const result = adjustScore(model({ score: 82, fit: "spam" }), companyLead);
    expect(result.fit).toBe("high");
    expect(result.modelFit).toBe("spam");
  });

  it("keeps the model fit when it is exactly one band away", () => {
    expect(adjustScore(model({ score: 45, fit: "low" }), companyLead).fit).toBe("low");
    expect(adjustScore(model({ score: 35, fit: "medium" }), companyLead).fit).toBe("medium");
  });

  it("forces spam with score 0 when the honeypot was filled, regardless of the model", () => {
    const result = adjustScore(model(), { ...companyLead, honeypotFilled: true });
    expect(result).toMatchObject({ score: 0, fit: "spam", modelScore: 78, modelFit: "high" });
    expect(result.adjustments).toEqual([
      { code: "honeypot", delta: -78, note: "Form honeypot field was filled: treated as spam" },
    ]);
  });

  it("does not mutate the model output", () => {
    const input = model();
    adjustScore(input, { email: "x@gmail.com", message: "hi" });
    expect(input).toEqual(model());
  });
});

describe("decideAction", () => {
  const pro = { plan: "pro", autonomy: "auto_high_score" } as const;
  const scored = (overrides: Partial<AdjustedScore> = {}): AdjustedScore => ({
    ...model(),
    modelScore: 78,
    modelFit: "high",
    adjustments: [],
    ...overrides,
  });

  it("exposes the spec thresholds", () => {
    expect(AUTO_REPLY_MIN_SCORE).toBe(70);
    expect(AUTO_REPLY_MIN_CONFIDENCE).toBe(0.8);
  });

  it("archives spam", () => {
    expect(decideAction(pro, scored({ score: 5, fit: "spam" }))).toBe("archive_spam");
  });

  it("drafts a decline for low fit", () => {
    expect(decideAction(pro, scored({ score: 30, fit: "low" }))).toBe("draft_decline");
  });

  it("drafts a reply for medium and high fit", () => {
    expect(decideAction(pro, scored({ score: 55, fit: "medium" }))).toBe("draft_reply");
    expect(decideAction({ plan: "free", autonomy: "manual" }, scored())).toBe("draft_reply");
  });

  it("auto-replies only on Pro + auto_high_score + score >= 70 + confidence >= 0.8", () => {
    expect(decideAction(pro, scored({ score: 70, confidence: 0.8 }))).toBe("auto_reply");
    expect(decideAction({ plan: "free", autonomy: "auto_high_score" }, scored())).toBe("draft_reply");
    expect(decideAction({ plan: "pro", autonomy: "manual" }, scored())).toBe("draft_reply");
    expect(decideAction(pro, scored({ score: 69 }))).toBe("draft_reply");
    expect(decideAction(pro, scored({ confidence: 0.79 }))).toBe("draft_reply");
    expect(decideAction(pro, scored({ confidence: Number.NaN }))).toBe("draft_reply");
  });

  it("never auto-replies to a medium-fit lead even with a high score", () => {
    // Possible when the model's fit is one band below the score's band.
    expect(decideAction(pro, scored({ score: 75, fit: "medium" }))).toBe("draft_reply");
  });
});
