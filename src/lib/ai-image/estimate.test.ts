import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type Anthropic from "@anthropic-ai/sdk";

import { estimateImage, InvalidModelOutputError, isJpeg, type EstimateClient } from "./estimate";
import { IMAGE_REPORT_TOOL } from "./prompt";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46]);

function scripted(input: unknown, seen: Anthropic.MessageCreateParamsNonStreaming[] = []): EstimateClient {
  return {
    messages: {
      async create(params) {
        seen.push(params);
        return {
          id: "msg_test",
          type: "message",
          role: "assistant",
          model: params.model,
          content: [{ type: "tool_use", id: "tu_1", name: IMAGE_REPORT_TOOL.name, input }],
          stop_reason: "tool_use",
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 1 },
        } as unknown as Anthropic.Message;
      },
    },
  };
}

describe("estimateImage", () => {
  test("sends only the image with a forced report tool", async () => {
    const seen: Anthropic.MessageCreateParamsNonStreaming[] = [];
    await estimateImage({ client: scripted({ assessment: "no_clear_signs", artifacts: [] }, seen), model: "m", jpeg: JPEG });
    const [params] = seen;
    assert.deepEqual(params.tool_choice, { type: "tool", name: "report_image_estimate" });
    const content = params.messages[0].content as Anthropic.ContentBlockParam[];
    assert.equal(content[0].type, "image");
    assert.equal(content.length, 2);
  });

  test("style-only possibly_ai comes back as no_clear_signs", async () => {
    const result = await estimateImage({ client: scripted({ assessment: "possibly_ai", artifacts: [] }), model: "m", jpeg: JPEG });
    assert.equal(result.assessment, "no_clear_signs");
  });

  test("a malformed answer is an error, never a made-up result", async () => {
    for (const input of [{ assessment: "ai" }, "nonsense", {}]) {
      await assert.rejects(estimateImage({ client: scripted(input), model: "m", jpeg: JPEG }), InvalidModelOutputError);
    }
  });

  test("isJpeg", () => {
    assert.equal(isJpeg(JPEG), true);
    assert.equal(isJpeg(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), false);
  });
});
