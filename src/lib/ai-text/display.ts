/**
 * AI Check 2b, the AI-written text estimate: the parts shared by the server
 * route and the browser extension (text limits, response parsing, wording).
 * Browser-safe and pure, so both sides use the same rules and the wording is
 * unit tested.
 *
 * Every result that comes from the model is labeled an estimate. That rule
 * is non-negotiable (EXTENSION_SPEC.md "UI copy rules"): AI-text detection
 * has real false-positive rates, and a person wrongly flagged as AI-written
 * is a real harm. `display.test.ts` checks every label.
 */

/** The model's possible judgments. "unclear" is the default when evidence is weak or mixed. */
export const TEXT_ASSESSMENTS = ["likely_ai", "unclear", "likely_human"] as const;
export type TextAssessment = (typeof TEXT_ASSESSMENTS)[number];

/** Below this, no estimate is attempted and nothing is sent. */
export const MIN_WORDS = 150;
/** At most this much text is sent (about 2,000 words); the rest is cut off. */
export const MAX_CHARS = 12_000;
/** Longest rationale shown, in characters. */
export const MAX_RATIONALE_CHARS = 300;

export function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** Collapses whitespace and cuts to MAX_CHARS at a word boundary. */
export function prepareText(text: string): string {
  const normalized = text.replace(/[ \t\f\v ]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
  if (normalized.length <= MAX_CHARS) return normalized;
  const cut = normalized.slice(0, MAX_CHARS);
  const lastSpace = cut.search(/\s\S*$/);
  return (lastSpace > MAX_CHARS * 0.8 ? cut.slice(0, lastSpace) : cut).trim();
}

/** Body of a successful `POST /api/ai-check/text` response. */
export type TextEstimateResponse =
  | { result: "estimate"; assessment: TextAssessment; rationale: string; words_analyzed: number }
  | { result: "not_enough_text"; words_analyzed: number };

export function parseTextEstimateResponse(body: unknown): TextEstimateResponse | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  if (typeof b.words_analyzed !== "number") return null;
  if (b.result === "not_enough_text") return { result: "not_enough_text", words_analyzed: b.words_analyzed };
  if (
    b.result === "estimate" &&
    TEXT_ASSESSMENTS.includes(b.assessment as TextAssessment) &&
    typeof b.rationale === "string"
  ) {
    return {
      result: "estimate",
      assessment: b.assessment as TextAssessment,
      rationale: b.rationale.slice(0, MAX_RATIONALE_CHARS),
      words_analyzed: b.words_analyzed,
    };
  }
  return null;
}

export const ESTIMATE_LABELS: Record<TextAssessment, string> = {
  likely_ai: "Likely AI-written (estimate)",
  unclear: "Can't tell (estimate)",
  likely_human: "Likely human-written (estimate)",
};

export const ESTIMATE_CAVEAT = "AI-text detection is often wrong. Don't use this to judge or accuse anyone.";

export type TextEstimateOutcome =
  | { kind: "response"; response: TextEstimateResponse }
  | { kind: "too_short"; words: number }
  | { kind: "rate_limited"; retryAfterSeconds: number | null }
  | { kind: "unavailable"; message?: string }
  | { kind: "cant_inspect" }
  | { kind: "error" };

export type TextEstimateDisplay = {
  /** "estimate" results get the estimate styling; everything else is a plain notice. */
  tone: "estimate" | "notice";
  title: string;
  rationale?: string;
  details: string[];
};

function wordsLine(words: number): string {
  return `${words.toLocaleString("en-US")} words of this page's main text were sent.`;
}

function waitPhrase(seconds: number | null): string {
  if (!seconds) return "later";
  if (seconds < 90) return "in a minute";
  if (seconds < 90 * 60) return `in about ${Math.round(seconds / 60)} minutes`;
  return `in about ${Math.round(seconds / 3600)} hours`;
}

/** Popup wording for the text estimate. */
export function describeTextEstimate(outcome: TextEstimateOutcome): TextEstimateDisplay {
  switch (outcome.kind) {
    case "response": {
      const { response } = outcome;
      if (response.result === "not_enough_text") {
        return { tone: "notice", title: "Not enough text to estimate", details: [`At least ${MIN_WORDS} words are needed.`] };
      }
      return {
        tone: "estimate",
        title: ESTIMATE_LABELS[response.assessment],
        rationale: response.rationale,
        details: [wordsLine(response.words_analyzed), ESTIMATE_CAVEAT],
      };
    }
    case "too_short":
      return {
        tone: "notice",
        title: "Not enough text to estimate",
        details: [`Found ${outcome.words} words of main text; at least ${MIN_WORDS} are needed. Nothing was sent.`],
      };
    case "rate_limited":
      return {
        tone: "notice",
        title: "Check limit reached",
        details: [`Writing checks are limited to keep the service free. Try again ${waitPhrase(outcome.retryAfterSeconds)}.`],
      };
    case "unavailable":
      return { tone: "notice", title: "Writing check unavailable", details: [outcome.message ?? "This TrustTab instance can't run writing checks right now."] };
    case "cant_inspect":
      return { tone: "notice", title: "Can't read this page", details: ["Chrome doesn't let extensions read this kind of page. Nothing was sent."] };
    case "error":
      return { tone: "notice", title: "Writing check failed", details: ["Couldn't get an estimate. Please try again."] };
  }
}
