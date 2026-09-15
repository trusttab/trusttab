import Anthropic from "@anthropic-ai/sdk";

import { DEFAULT_AI_TEXT_MODEL, estimateText, InvalidModelOutputError } from "@/lib/ai-text/estimate";
import { countWords, MAX_CHARS, MIN_WORDS, prepareText } from "@/lib/ai-text/display";
import { aiTextRateLimits } from "@/lib/ai-check/limits";
import { enforcePaidRateLimits } from "@/lib/rate-limit";

export const maxDuration = 30;

/** Request bodies larger than this are rejected before parsing (text is capped far lower). */
const MAX_BODY_BYTES = 64_000;

// Called from the browser extension's popup: any origin, never with cookies.
const HEADERS = {
  "access-control-allow-origin": "*",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

const json = (status: number, body: unknown, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...HEADERS, ...extra, "content-type": "application/json; charset=utf-8" },
  });

export function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      ...HEADERS,
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type",
      "access-control-max-age": "600",
    },
  });
}

/**
 * POST /api/ai-check/text: public. Body `{ "text": "<page main text>" }`.
 * Returns an estimate of whether the text is AI-written, for the extension's
 * AI Check tab. It is always an estimate and must be labeled as one
 * (src/lib/ai-text/display.ts).
 *
 * Privacy: the text is sent to the model for this request only. It is not
 * logged, stored or written to the traffic log, and errors are logged
 * without it. No URL or domain is accepted.
 */
export async function POST(request: Request) {
  if (!process.env.ANTHROPIC_API_KEY) return json(503, { error: "Writing checks aren't configured on this instance." });

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return json(413, { error: "Text too large." });
  const raw = await request.text().catch(() => "");
  if (raw.length > MAX_BODY_BYTES) return json(413, { error: "Text too large." });

  let text: unknown;
  try {
    text = (JSON.parse(raw) as { text?: unknown }).text;
  } catch {
    text = undefined;
  }
  if (typeof text !== "string" || !text.trim()) return json(400, { error: 'Expected { "text": "..." }.' });

  const rawText = text.slice(0, MAX_CHARS * 2);

  // Short text is answered without a model call, so it doesn't count against the limits.
  const words = countWords(prepareText(rawText));
  if (words < MIN_WORDS) return json(200, { result: "not_enough_text", words_analyzed: words });

  const limited = await enforcePaidRateLimits(request, aiTextRateLimits(), HEADERS);
  if (limited) return limited;

  try {
    const client = new Anthropic({ maxRetries: 1, timeout: 20_000 });
    const model = process.env.AI_TEXT_MODEL || DEFAULT_AI_TEXT_MODEL;
    return json(200, await estimateText({ client, model, rawText, signal: request.signal }));
  } catch (err) {
    // Log only the error class and status: never the request or the page text.
    if (err instanceof Anthropic.RateLimitError) {
      console.error("[ai-text] model rate limited");
      return json(503, { error: "The writing check is busy. Please try again in a minute." }, { "retry-after": "60" });
    }
    if (err instanceof Anthropic.APIError) {
      console.error("[ai-text] model API error", err.status);
      return json(502, { error: "Couldn't reach the AI service. Please try again." });
    }
    if (err instanceof InvalidModelOutputError) {
      console.error("[ai-text] invalid model output");
      return json(502, { error: "Couldn't get an estimate. Please try again." });
    }
    if (request.signal.aborted) return json(499, { error: "Request cancelled." });
    console.error("[ai-text] failed", err instanceof Error ? err.name : "unknown");
    return json(500, { error: "Something went wrong." });
  }
}

