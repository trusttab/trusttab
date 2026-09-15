import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { requestTextEstimate } from "./text-estimate";

const LONG = "Our family has run this hardware store on Main Street since 1962, and we still cut keys by hand. ".repeat(10);

function fakeFetch(status: number, body: unknown, headers: Record<string, string> = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("requestTextEstimate", () => {
  test("short text never leaves the browser", async () => {
    const { impl, calls } = fakeFetch(200, {});
    assert.deepEqual(await requestTextEstimate("https://tt.example", "Too short to judge.", impl), { kind: "too_short", words: 4 });
    assert.equal(calls.length, 0);
  });

  test("sends only the text, without cookies or referrer", async () => {
    const { impl, calls } = fakeFetch(200, { result: "estimate", assessment: "likely_human", rationale: "Specific history.", evidence: [], words_analyzed: 190 });
    const outcome = await requestTextEstimate("https://tt.example", LONG, impl);
    assert.equal(outcome.kind, "response");
    const [{ url, init }] = calls;
    assert.equal(url, "https://tt.example/api/ai-check/text");
    assert.equal(init.credentials, "omit");
    assert.equal(init.referrerPolicy, "no-referrer");
    assert.deepEqual(Object.keys(JSON.parse(String(init.body))), ["text"]);
  });

  test("maps limits, capacity and failures", async () => {
    assert.deepEqual(await requestTextEstimate("https://tt.example", LONG, fakeFetch(429, { error: "x" }, { "retry-after": "1800" }).impl), {
      kind: "rate_limited",
      retryAfterSeconds: 1800,
    });
    assert.deepEqual(await requestTextEstimate("https://tt.example", LONG, fakeFetch(503, { error: "Capacity reached." }).impl), {
      kind: "unavailable",
      message: "Capacity reached.",
    });
    assert.deepEqual(await requestTextEstimate("https://tt.example", LONG, fakeFetch(502, { error: "x" }).impl), { kind: "error" });
    assert.deepEqual(await requestTextEstimate("https://tt.example", LONG, fakeFetch(200, { result: "estimate", assessment: "ai" }).impl), { kind: "error" });
    const throwing = (async () => {
      throw new TypeError("offline");
    }) as unknown as typeof fetch;
    assert.deepEqual(await requestTextEstimate("https://tt.example", LONG, throwing), { kind: "error" });
  });
});
