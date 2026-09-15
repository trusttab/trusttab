import "server-only";

import type Anthropic from "@anthropic-ai/sdk";

import { applyArtifactRule, IMAGE_ASSESSMENTS, parseArtifacts, type ImageAssessment, type ImageEstimateResponse } from "./display";
import { IMAGE_ESTIMATE_PROMPT, IMAGE_REPORT_TOOL } from "./prompt";

/** Default model; override with AI_IMAGE_MODEL. */
export const DEFAULT_AI_IMAGE_MODEL = "claude-haiku-4-5-20251001";

export type EstimateClient = {
  messages: {
    create(params: Anthropic.MessageCreateParamsNonStreaming, options?: { signal?: AbortSignal }): Promise<Anthropic.Message>;
  };
};

export class InvalidModelOutputError extends Error {}

/** True if `bytes` start with a JPEG signature (the extension always sends a re-encoded JPEG). */
export function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

/**
 * Asks the model whether a JPEG shows concrete visual signs of AI generation.
 * The image is used only for this request: it is not logged or stored.
 */
export async function estimateImage(args: {
  client: EstimateClient;
  model: string;
  jpeg: Uint8Array;
  signal?: AbortSignal;
}): Promise<ImageEstimateResponse> {
  const message = await args.client.messages.create(
    {
      model: args.model,
      max_tokens: 400,
      temperature: 0,
      system: IMAGE_ESTIMATE_PROMPT,
      tools: [IMAGE_REPORT_TOOL],
      tool_choice: { type: "tool", name: IMAGE_REPORT_TOOL.name },
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: Buffer.from(args.jpeg).toString("base64") } },
            { type: "text", text: "Report on this image." },
          ],
        },
      ],
    },
    { signal: args.signal },
  );

  const call = message.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === IMAGE_REPORT_TOOL.name);
  const input = call?.input as { assessment?: unknown; artifacts?: unknown } | undefined;
  if (!input || !IMAGE_ASSESSMENTS.includes(input.assessment as ImageAssessment)) {
    // Never invent a result: a malformed answer is an error.
    throw new InvalidModelOutputError("The model didn't return a valid estimate.");
  }
  return applyArtifactRule(input.assessment as ImageAssessment, parseArtifacts(input.artifacts));
}
