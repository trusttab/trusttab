import "server-only";

import type Anthropic from "@anthropic-ai/sdk";

import {
  countWords,
  MAX_RATIONALE_CHARS,
  MIN_WORDS,
  prepareText,
  TEXT_ASSESSMENTS,
  type TextAssessment,
  type TextEstimateResponse,
} from "./display";
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
  const input = call?.input as { assessment?: unknown; rationale?: unknown } | undefined;
  if (!input || !TEXT_ASSESSMENTS.includes(input.assessment as TextAssessment) || typeof input.rationale !== "string") {
    // Never invent a result: a malformed answer is an error, not "unclear".
    throw new InvalidModelOutputError("The model didn't return a valid estimate.");
  }

  return {
    result: "estimate",
    assessment: input.assessment as TextAssessment,
    rationale: cleanRationale(input.rationale),
    words_analyzed: words,
  };
}

function cleanRationale(value: string): string {
  const oneLine = value.replace(/\s+/g, " ").trim();
  return oneLine.length <= MAX_RATIONALE_CHARS ? oneLine : `${oneLine.slice(0, MAX_RATIONALE_CHARS - 1).trimEnd()}…`;
}
