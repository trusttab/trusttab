import "server-only";

import type Anthropic from "@anthropic-ai/sdk";

import {
  countWords,
  MAX_EVIDENCE_CHARS,
  MAX_EVIDENCE_ITEMS,
  MAX_RATIONALE_CHARS,
  MIN_WORDS,
  prepareText,
  TEXT_ASSESSMENTS,
  type TextAssessment,
  type TextEstimateResponse,
} from "./display";
import { matchArtifactPattern } from "./artifacts";
import { pageTextMessage, REPORT_TOOL, TEXT_ESTIMATE_PROMPT } from "./prompt";

/** Default model; override with AI_TEXT_MODEL. Cheap on purpose: no model does this reliably. */
export const DEFAULT_AI_TEXT_MODEL = "claude-haiku-4-5-20251001";

/** The slice of the Anthropic client this needs, so tests can inject a scripted model. */
export type EstimateClient = {
  messages: {
    create(params: Anthropic.MessageCreateParamsNonStreaming, options?: { signal?: AbortSignal }): Promise<Anthropic.Message>;
  };
};

export class InvalidModelOutputError extends Error {}

/**
 * Asks the model for an estimate of whether `rawText` is AI-written. Text
 * under MIN_WORDS returns `not_enough_text` without calling the model. The
 * text is used only for this request: it is not logged or stored.
 */
export async function estimateText(args: {
  client: EstimateClient;
  model: string;
  rawText: string;
  signal?: AbortSignal;
}): Promise<TextEstimateResponse> {
  const text = prepareText(args.rawText);
  const words = countWords(text);
  if (words < MIN_WORDS) return { result: "not_enough_text", words_analyzed: words };

  const message = await args.client.messages.create(
    {
      model: args.model,
      max_tokens: 300,
      temperature: 0,
      system: TEXT_ESTIMATE_PROMPT,
      tools: [REPORT_TOOL],
      tool_choice: { type: "tool", name: REPORT_TOOL.name },
      messages: [{ role: "user", content: pageTextMessage(text) }],
    },
    { signal: args.signal },
  );

  const call = message.content.find((block): block is Anthropic.ToolUseBlock => block.type === "tool_use" && block.name === REPORT_TOOL.name);
  const input = call?.input as { assessment?: unknown; rationale?: unknown; ai_artifacts?: unknown } | undefined;
  if (!input || !TEXT_ASSESSMENTS.includes(input.assessment as TextAssessment) || typeof input.rationale !== "string") {
    // Never invent a result: a malformed answer is an error, not "unclear".
    throw new InvalidModelOutputError("The model didn't return a valid estimate.");
  }

  return applyEvidenceRule(
    {
      result: "estimate",
      assessment: input.assessment as TextAssessment,
      rationale: cleanRationale(input.rationale),
      evidence: [],
      words_analyzed: words,
    },
    Array.isArray(input.ai_artifacts) ? input.ai_artifacts : [],
    text,
  );
}

/** Shown when likely_ai is downgraded for lack of a verified artifact; the model's reason argued for AI, so it isn't shown. */
export const STYLE_ONLY_RATIONALE =
  "The writing has traits sometimes seen in AI text, but people write this way too, and no direct sign of AI generation was found in the page.";

/**
 * The bias rule, enforced in code (the prompt states it too): likely_ai
 * stands only with at least one quote that appears verbatim in the page text
 * AND matches a known artifact pattern (artifacts.ts). Otherwise the result
 * is "unclear". Quotes the model paraphrased or invented don't count, and
 * neither do stock phrases the model offered as "artifacts". Wrongly calling a person's
 * writing AI-written is the worse mistake, and a prompt alone didn't hold.
 *
 * Limit: code can verify that a quote is on the page and looks like a
 * known artifact, not that it really is one (an article may quote a
 * chatbot). That part stays the model's judgment, which is why the result
 * is still labeled an estimate.
 */
export function applyEvidenceRule(
  estimate: Extract<TextEstimateResponse, { result: "estimate" }>,
  artifacts: unknown[],
  pageText: string,
): Extract<TextEstimateResponse, { result: "estimate" }> {
  if (estimate.assessment !== "likely_ai") return { ...estimate, evidence: [] };

  const haystack = normalizeForQuote(pageText);
  const verified = artifacts
    .filter((a): a is string => typeof a === "string")
    .map((a) => a.replace(/\s+/g, " ").trim())
    .filter((a) => a.length <= MAX_EVIDENCE_CHARS && matchArtifactPattern(a) !== null && haystack.includes(normalizeForQuote(a)))
    .slice(0, MAX_EVIDENCE_ITEMS);

  if (verified.length === 0) return { ...estimate, assessment: "unclear", rationale: STYLE_ONLY_RATIONALE, evidence: [] };
  return { ...estimate, evidence: verified };
}

function normalizeForQuote(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanRationale(value: string): string {
  const oneLine = value.replace(/\s+/g, " ").trim();
  return oneLine.length <= MAX_RATIONALE_CHARS ? oneLine : `${oneLine.slice(0, MAX_RATIONALE_CHARS - 1).trimEnd()}…`;
}
