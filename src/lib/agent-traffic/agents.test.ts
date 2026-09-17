import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { AGENT_SIGNATURES, matchAgentSignature } from "./agents";

describe("agent user-agent signatures", () => {
  test("entries are well-formed and uniquely identified", () => {
    const ids = new Set<string>();
    for (const signature of AGENT_SIGNATURES) {
      assert.ok(!ids.has(signature.id), `duplicate id ${signature.id}`);
      ids.add(signature.id);
      assert.ok(signature.name.length > 0 && signature.operator.length > 0, signature.id);
    }
    assert.equal(AGENT_SIGNATURES.filter((s) => s.kind === "trusttab").length, 1);
  });

  test("matches real agent user agents", () => {
    const cases: [string, string][] = [
      ["Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)", "gptbot"],
      ["Mozilla/5.0 ... ChatGPT-User/1.0; +https://openai.com/bot", "chatgpt-user"],
      ["Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)", "claudebot"],
      ["Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)", "perplexitybot"],
      ["Mozilla/5.0 (compatible; Google-Extended/1.0)", "google-extended"],
      ["TrustTabBot/0.1 (site ownership and agent-trust verification)", "trusttab"],
      ["Mozilla/5.0+(compatible; UptimeRobot/2.0; http://www.uptimerobot.com/)", "uptimerobot"],
      ["curl/8.7.1", "curl"],
    ];
    for (const [userAgent, id] of cases) assert.equal(matchAgentSignature(userAgent)?.id, id, userAgent);
  });

  test("ordinary browsers and empty user agents don't match", () => {
    for (const userAgent of [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
      "",
      null,
    ]) {
      assert.equal(matchAgentSignature(userAgent), null, String(userAgent).slice(0, 40));
    }
  });

  test("TrustTab's own fetcher is recognized, so a site's checks aren't counted as visitors", () => {
    // Must stay in step with USER_AGENT in src/lib/safe-fetch.ts.
    assert.equal(matchAgentSignature("TrustTabBot/0.1 (site ownership and agent-trust verification)")?.kind, "trusttab");
  });
});
