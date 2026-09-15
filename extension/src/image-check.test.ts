import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { fetchWithPermission, originPattern, requestImageEstimate, sniffImageFormat } from "./image-check";

describe("image helpers", () => {
  test("originPattern only for web images", () => {
    assert.equal(originPattern("https://cdn.example.com/a/b.jpg?x=1"), "https://cdn.example.com/*");
    assert.equal(originPattern("data:image/png;base64,AAAA"), null);
    assert.equal(originPattern("blob:https://example.com/uuid"), null);
  });

  test("sniffImageFormat trusts bytes over the declared type", () => {
    assert.equal(sniffImageFormat(new Uint8Array([0xff, 0xd8, 0xff, 0xe1]), "text/html"), "image/jpeg");
    assert.equal(sniffImageFormat(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ""), "image/png");
    assert.equal(sniffImageFormat(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]), ""), "image/webp");
    assert.equal(sniffImageFormat(new Uint8Array([0, 0, 0, 0x1c, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66]), ""), "image/avif");
    assert.equal(sniffImageFormat(new TextEncoder().encode("<svg"), "image/svg+xml"), "image/svg+xml");
    assert.equal(sniffImageFormat(new TextEncoder().encode("GIF89a"), "image/gif"), null);
  });

  test("fetchWithPermission never sends cookies or a referrer", async () => {
    let init: RequestInit | undefined;
    const fake = (async (_url: string, i: RequestInit) => {
      init = i;
      return new Response(new Uint8Array([1, 2, 3]));
    }) as unknown as typeof fetch;
    const result = await fetchWithPermission("https://cdn.example.com/a.jpg", fake);
    assert.equal(result.kind, "ok");
    assert.equal(init?.credentials, "omit");
    assert.equal(init?.referrerPolicy, "no-referrer");
  });
});

describe("requestImageEstimate", () => {
  const jpeg = new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: "image/jpeg" });
  const reply = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    (async () => new Response(JSON.stringify(body), { status, headers })) as unknown as typeof fetch;

  test("sends only the JPEG, and re-applies the artifact rule to the response", async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const fake = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(JSON.stringify({ result: "estimate", assessment: "possibly_ai", artifacts: [] }));
    }) as unknown as typeof fetch;
    const outcome = await requestImageEstimate("https://tt.example", jpeg, fake);
    assert.equal(seen?.url, "https://tt.example/api/ai-check/image");
    assert.equal(seen?.init.credentials, "omit");
    assert.equal((seen?.init.headers as Record<string, string>)["content-type"], "image/jpeg");
    assert.deepEqual(outcome, { kind: "response", response: { result: "estimate", assessment: "no_clear_signs", artifacts: [] } });
  });

  test("maps limits, capacity and failures", async () => {
    assert.deepEqual(await requestImageEstimate("https://tt.example", jpeg, reply(429, {}, { "retry-after": "120" })), { kind: "rate_limited", retryAfterSeconds: 120 });
    assert.deepEqual(await requestImageEstimate("https://tt.example", jpeg, reply(503, { error: "Capacity." })), { kind: "unavailable", message: "Capacity." });
    assert.deepEqual(await requestImageEstimate("https://tt.example", jpeg, reply(502, {})), { kind: "error" });
  });
});
