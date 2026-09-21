/**
 * The AI Check summary badge: a display format over the concrete checks, not
 * an opinion on top of them (EXTENSION_SPEC "The summary badge").
 *
 * The colour is a mechanical function of how many *independent* concrete
 * checks fired:
 *   green  — none fired
 *   yellow — exactly one
 *   red    — two or more different checks, e.g. a sensitive-info request and
 *            a domain lookalike. One finding stays yellow however severe it
 *            looks, and severity is never weighed.
 *
 * Only deterministic checks can contribute. Detecting an AI application, an
 * AI agent widget or a chat widget never does: AI involvement is reported as
 * a fact elsewhere and must not be folded into a safety signal. The writing
 * and image estimates never do either, because they are model judgments.
 */

export type SafetyFinding = {
  /** The check that produced it. Two findings from the same check count once. */
  check: "sensitive-request" | "domain-lookalike" | "product-mismatch";
  title: string;
  details: string[];
};

export type SafetyTier = "green" | "yellow" | "red";

export type SafetySummary = {
  tier: SafetyTier;
  title: string;
  summary: string;
  findings: SafetyFinding[];
};

export function summarizeSafety(findings: SafetyFinding[]): SafetySummary {
  const distinctChecks = new Set(findings.map((f) => f.check)).size;

  if (distinctChecks === 0) {
    return {
      tier: "green",
      title: "No concerns found in our checks",
      summary:
        "These checks found nothing. That isn't a promise the page is safe; it's what these specific checks look for. Anything shown below is information, not a concern.",
      findings,
    };
  }
  if (distinctChecks === 1) {
    return {
      tier: "yellow",
      title: "Something to review",
      summary: "One check found something. It's shown below, with what was actually found.",
      findings,
    };
  }
  return {
    tier: "red",
    title: "Multiple signs of a possible scam",
    summary: `${distinctChecks} independent checks found something. All of them are listed below.`,
    findings,
  };
}
