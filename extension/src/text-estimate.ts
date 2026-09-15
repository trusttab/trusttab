import { countWords, MIN_WORDS, parseTextEstimateResponse, prepareText, type TextEstimateOutcome } from "@/lib/ai-text/display";

const TIMEOUT_MS = 25_000;

/**
 * Sends extracted page text to TrustTab for an AI-written estimate. Called
 * only from the "Check this page's writing" button. Sends the text alone (no
 * URL, domain or title) and never cookies. Text under the minimum length is
 * answered locally, so nothing leaves the browser.
 */
export async function requestTextEstimate(
  apiBase: string,
  rawText: string,
  fetchImpl: typeof fetch = fetch,
): Promise<TextEstimateOutcome> {
  const text = prepareText(rawText);
  const words = countWords(text);
  if (words < MIN_WORDS) return { kind: "too_short", words };

  let response: Response;
  try {
    response = await fetchImpl(`${apiBase}/api/ai-check/text`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
      credentials: "omit",
      referrerPolicy: "no-referrer",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { kind: "error" };
  }

  if (response.status === 429) {
    const retryAfter = Number(response.headers.get("retry-after"));
    return { kind: "rate_limited", retryAfterSeconds: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null };
  }
  const body: unknown = await response.json().catch(() => null);
  if (response.status === 503) {
    const message = (body as { error?: unknown } | null)?.error;
    return { kind: "unavailable", message: typeof message === "string" ? message.slice(0, 200) : undefined };
  }
  if (!response.ok) return { kind: "error" };

  const parsed = parseTextEstimateResponse(body);
  return parsed ? { kind: "response", response: parsed } : { kind: "error" };
}
