import Anthropic from "@anthropic-ai/sdk";

import { aiImageRateLimits } from "@/lib/ai-check/limits";
import { MAX_IMAGE_BYTES } from "@/lib/ai-image/display";
import { DEFAULT_AI_IMAGE_MODEL, estimateImage, InvalidModelOutputError, isJpeg } from "@/lib/ai-image/estimate";
import { enforcePaidRateLimits } from "@/lib/rate-limit";

export const maxDuration = 30;

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
 * POST /api/ai-check/image: public. Body: a JPEG (`content-type: image/jpeg`),
 * which the extension produces by downscaling the chosen image. Returns an
 * estimate of whether it shows visual signs of AI generation, for AI Check
 * Tier 2. It is always an estimate (src/lib/ai-image/display.ts).
 *
 * Privacy: the image is sent to the model for this request only. It is not
 * logged, stored or written to the traffic log. No URL or page address is
 * accepted.
 */
export async function POST(request: Request) {
  if (!process.env.ANTHROPIC_API_KEY) return json(503, { error: "Image estimates aren't configured on this instance." });
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "image/jpeg") {
    return json(415, { error: "Send the image as image/jpeg." });
  }
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_IMAGE_BYTES) return json(413, { error: "Image too large." });

  const bytes = new Uint8Array(await request.arrayBuffer().catch(() => new ArrayBuffer(0)));
  if (bytes.length > MAX_IMAGE_BYTES) return json(413, { error: "Image too large." });
  if (!isJpeg(bytes)) return json(400, { error: "Expected a JPEG image." });

  const limited = await enforcePaidRateLimits(request, aiImageRateLimits(), HEADERS);
  if (limited) return limited;

  try {
    const client = new Anthropic({ maxRetries: 1, timeout: 25_000 });
    const model = process.env.AI_IMAGE_MODEL || DEFAULT_AI_IMAGE_MODEL;
    return json(200, await estimateImage({ client, model, jpeg: bytes, signal: request.signal }));
  } catch (err) {
    // Log only the error class and status: never the request or the image.
    if (err instanceof Anthropic.RateLimitError) {
      console.error("[ai-image] model rate limited");
      return json(503, { error: "The image estimate is busy. Please try again in a minute." }, { "retry-after": "60" });
    }
    if (err instanceof Anthropic.APIError) {
      console.error("[ai-image] model API error", err.status);
      return json(502, { error: "Couldn't reach the AI service. Please try again." });
    }
    if (err instanceof InvalidModelOutputError) {
      console.error("[ai-image] invalid model output");
      return json(502, { error: "Couldn't get an estimate. Please try again." });
    }
    if (request.signal.aborted) return json(499, { error: "Request cancelled." });
    console.error("[ai-image] failed", err instanceof Error ? err.name : "unknown");
    return json(500, { error: "Something went wrong." });
  }
}
