import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type Anthropic from "@anthropic-ai/sdk";

import { estimateText, InvalidModelOutputError, STYLE_ONLY_RATIONALE, type EstimateClient } from "./estimate";
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
      client: scripted({ assessment: "likely_human", rationale: "  Specific local\n details and dates.  ", ai_artifacts: [] }, seen),
      model: "claude-haiku-4-5-20251001",
      rawText: LONG_TEXT,
    });
    assert.deepEqual(result, {
      result: "estimate",
      assessment: "likely_human",
      rationale: "Specific local details and dates.",
      evidence: [],
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
    const result = await estimateText({ client: scripted({ assessment: "unclear", rationale: "x ".repeat(400), ai_artifacts: [] }), model: "m", rawText: LONG_TEXT });
    assert.equal(result.result, "estimate");
    if (result.result === "estimate") assert.ok(result.rationale.length <= 300);
  });

  /**
   * Pins the bias in code, not just the prompt: "Likely AI-written" needs a
   * quoted artifact of AI generation that really appears in the page. The
   * first live test (leasetab.com) got likely_ai from Haiku on style alone.
   * If this fails, restore the rule; don't loosen the test.
   */
  describe("likely_ai needs a verified quoted artifact", () => {
    const MARKETING = "Prepare to be impressed. Our seamless platform empowers teams to unlock growth and elevate every experience. ".repeat(12);

    test("style alone becomes Can't tell, and the model's AI-leaning reason is not shown", async () => {
      const result = await estimateText({
        client: scripted({ assessment: "likely_ai", rationale: "Generic marketing phrases typical of AI.", ai_artifacts: [] }),
        model: "m",
        rawText: MARKETING,
      });
      assert.equal(result.result === "estimate" && result.assessment, "unclear");
      assert.equal(result.result === "estimate" && result.rationale, STYLE_ONLY_RATIONALE);
    });

    test("invented, paraphrased or style-only 'quotes' don't count", async () => {
      // Not on the page; paraphrased; on the page but only style (the second live test); not a string.
      for (const ai_artifacts of [["As an AI language model, I cannot"], ["prepare to be very impressed"], ["Prepare to be impressed", "unlock growth and elevate every experience"], [42]]) {
        const result = await estimateText({
          client: scripted({ assessment: "likely_ai", rationale: "r", ai_artifacts }),
          model: "m",
          rawText: MARKETING,
        });
        assert.equal(result.result === "estimate" && result.assessment, "unclear", JSON.stringify(ai_artifacts));
      }
    });

    test("a real artifact from the page keeps likely_ai and is returned as evidence", async () => {
      const page = `${MARKETING} Certainly! Here is a revised version of your homepage copy for [Company Name].`;
      const result = await estimateText({
        client: scripted({ assessment: "likely_ai", rationale: "Leftover chatbot reply.", ai_artifacts: ["Certainly! Here is a revised version", "not on the page at all"] }),
        model: "m",
        rawText: page,
      });
      assert.equal(result.result === "estimate" && result.assessment, "likely_ai");
      assert.deepEqual(result.result === "estimate" && result.evidence, ["Certainly! Here is a revised version"]);
    });

    test("evidence is never attached to other assessments", async () => {
      const result = await estimateText({
        client: scripted({ assessment: "likely_human", rationale: "r", ai_artifacts: ["Prepare to be impressed."] }),
        model: "m",
        rawText: MARKETING,
      });
      assert.deepEqual(result.result === "estimate" && result.evidence, []);
    });
  });
});
