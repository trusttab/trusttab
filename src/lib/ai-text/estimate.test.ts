import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type Anthropic from "@anthropic-ai/sdk";

import { estimateText, InvalidModelOutputError, type EstimateClient } from "./estimate";
import { REPORT_TOOL } from "./prompt";

const LONG_TEXT = "The bakery on Elm Street opened in 1987 and still bakes rye every Tuesday. ".repeat(20);

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
          content: [{ type: "tool_use", id: "tu_1", name: REPORT_TOOL.name, input }],
          stop_reason: "tool_use",
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 1 },
        } as unknown as Anthropic.Message;
      },
    },
  };
}

describe("estimateText", () => {
  test("short text is answered without calling the model", async () => {
    const seen: Anthropic.MessageCreateParamsNonStreaming[] = [];
    const result = await estimateText({ client: scripted({}, seen), model: "m", rawText: "Just a few words here." });
    assert.deepEqual(result, { result: "not_enough_text", words_analyzed: 5 });
    assert.equal(seen.length, 0);
  });

  test("forces the report tool and sends only the wrapped text", async () => {
    const seen: Anthropic.MessageCreateParamsNonStreaming[] = [];
    const result = await estimateText({
      client: scripted({ assessment: "likely_human", rationale: "  Specific local\n details and dates.  " }, seen),
      model: "claude-haiku-4-5-20251001",
      rawText: LONG_TEXT,
    });
    assert.deepEqual(result, {
      result: "estimate",
      assessment: "likely_human",
      rationale: "Specific local details and dates.",
      words_analyzed: 14 * 20,
    });
    const [params] = seen;
    assert.deepEqual(params.tool_choice, { type: "tool", name: "report_estimate" });
    assert.equal(params.messages.length, 1);
    assert.match(String(params.messages[0].content), /^<page_text>\n[\s\S]*\n<\/page_text>$/);
  });

  test("a malformed answer is an error, never a made-up result", async () => {
    for (const input of [{ assessment: "ai", rationale: "x" }, { assessment: "likely_ai" }, "nonsense"]) {
      await assert.rejects(estimateText({ client: scripted(input), model: "m", rawText: LONG_TEXT }), InvalidModelOutputError);
    }
  });

  test("long rationales are capped", async () => {
    const result = await estimateText({ client: scripted({ assessment: "unclear", rationale: "x ".repeat(400) }), model: "m", rawText: LONG_TEXT });
    assert.equal(result.result, "estimate");
    if (result.result === "estimate") assert.ok(result.rationale.length <= 300);
  });
});
