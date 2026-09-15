import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { diffManifestInputs } from "../manifest/diff";
import { draftInputSchema, EMPTY_INPUT } from "../manifest/input";
import type { ManifestInput } from "../manifest/types";
import { sameOriginBrowserRequestError } from "../same-origin";

const endpoint = (over: Partial<ManifestInput["endpoints"][number]> = {}): ManifestInput["endpoints"][number] => ({
  path: "/contact",
  method: "POST",
  purpose: "lead_inquiry",
  schema: { email: "email" },
  agent_safe: true,
  requires_captcha: false,
  self_attested: false,
  ...over,
});
const input = (endpoints: ManifestInput["endpoints"], over: Partial<ManifestInput> = {}): ManifestInput => ({
  no_prompt_injection_pledge: true,
  agent_rate_limit: { requests_per_minute: 30, captcha_exempt: false },
  endpoints,
  ...over,
});

describe("diffManifestInputs", () => {
  test("no changes produces no lines", () => {
    assert.deepEqual(diffManifestInputs(input([endpoint()]), input([endpoint()])), []);
  });

  test("describes added, removed and changed endpoints, and calls out attestations", () => {
    const before = input([endpoint(), endpoint({ path: "/old" })]);
    const after = input(
      [endpoint({ schema: { email: "email", name: "string" }, self_attested: true }), endpoint({ path: "/book", purpose: "booking" })],
      { agent_rate_limit: { requests_per_minute: 60, captcha_exempt: false } },
    );
    const lines = diffManifestInputs(before, after);
    assert.ok(lines.some((l) => l.kind === "added" && l.text.startsWith("New endpoint POST /book (booking)")));
    assert.ok(lines.some((l) => l.kind === "removed" && l.text === "Endpoint POST /old removed"));
    assert.ok(lines.some((l) => l.text === "POST /contact: added field name: string"));
    assert.ok(lines.some((l) => l.kind === "attestation" && l.text.includes("self-attest that the form at POST /contact")));
    assert.ok(lines.some((l) => l.text === "Agent rate limit 30 → 60 requests/minute"));
  });

  test("first publish lists everything as new, including the pledge", () => {
    const lines = diffManifestInputs(null, input([endpoint({ self_attested: true })]));
    assert.equal(lines.filter((l) => l.kind === "attestation").length, 2);
  });
});

describe("draftInputSchema", () => {
  test("accepts an empty draft and a full draft", () => {
    assert.ok(draftInputSchema.safeParse(EMPTY_INPUT).success);
    assert.ok(draftInputSchema.safeParse(input([endpoint()])).success);
  });
  test("rejects unknown keys, unknown purposes and oversize drafts", () => {
    assert.equal(draftInputSchema.safeParse({ ...input([]), extra: 1 }).success, false);
    assert.equal(draftInputSchema.safeParse(input([endpoint({ purpose: "free_text" as never })])).success, false);
    assert.equal(draftInputSchema.safeParse(input(Array.from({ length: 51 }, (_, i) => endpoint({ path: `/p${i}` })))).success, false);
  });
});

describe("sameOriginBrowserRequestError", () => {
  const app = "https://trusttab.test";
  const req = (headers: Record<string, string>) => new Request(`${app}/api/x`, { method: "POST", headers });
  test("accepts a same-origin browser request", () => {
    assert.equal(sameOriginBrowserRequestError(req({ origin: app, "sec-fetch-site": "same-origin" }), app), null);
  });
  test("rejects missing or foreign origins and non-same-origin fetch metadata", () => {
    assert.notEqual(sameOriginBrowserRequestError(req({}), app), null);
    assert.notEqual(sameOriginBrowserRequestError(req({ origin: "https://evil.test", "sec-fetch-site": "same-origin" }), app), null);
    assert.notEqual(sameOriginBrowserRequestError(req({ origin: app, "sec-fetch-site": "cross-site" }), app), null);
    assert.notEqual(sameOriginBrowserRequestError(req({ origin: app }), app), null);
  });
});
