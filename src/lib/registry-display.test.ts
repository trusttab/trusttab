import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { describeLookup, parseRegistryResponse, type RegistryResponse } from "./registry-display";

const fmt = (iso: string) => iso.slice(0, 10);
const entry = (over: Partial<RegistryResponse> = {}): RegistryResponse => ({
  verification_id: "tt_abcdefgh2345",
  status: "verified",
  domain: "acme.com",
  verified_at: "2026-09-14T12:00:00.000Z",
  expires_at: "2026-10-14T12:00:00.000Z",
  self_declared_endpoints: [],
  ...over,
});
const show = (over: Partial<RegistryResponse>) => describeLookup({ kind: "entry", entry: entry(over) }, fmt);

describe("describeLookup", () => {
  test("only 'verified' is shown as Verified", () => {
    assert.equal(show({ status: "verified" }).tone, "verified");
    assert.equal(show({ status: "verified" }).title, "Verified");
    for (const status of ["self_declared", "pending", "needs_fix", "failed", "expired"] as const) {
      assert.notEqual(show({ status }).title, "Verified", status);
      assert.notEqual(show({ status }).tone, "verified", status);
    }
  });

  test("self-declared is its own state and names the unconfirmed forms", () => {
    const d = show({ status: "self_declared", verified_at: null, self_declared_endpoints: [{ method: "POST", path: "/contact", purpose: "lead_inquiry" }] });
    assert.equal(d.tone, "self_declared");
    assert.equal(d.title, "Self-declared");
    assert.ok(d.facts.includes("Declared by the owner, not confirmed: POST /contact (lead_inquiry)"));
  });

  test("needs_fix and expired show Needs re-check; a failed injection scan keeps its finding visible", () => {
    assert.equal(show({ status: "needs_fix" }).title, "Needs re-check");
    assert.equal(show({ status: "expired" }).title, "Needs re-check");
    const failed = show({ status: "failed" });
    assert.equal(failed.title, "Needs re-check");
    assert.equal(failed.tone, "recheck");
    assert.match(failed.finding ?? "", /content on this site that could mislead AI agents/);
    assert.equal(show({ status: "needs_fix" }).finding, undefined);
  });

  test("pending and not found are neutral 'Not verified', never a warning", () => {
    assert.deepEqual([show({ status: "pending" }).tone, show({ status: "pending" }).title], ["unknown", "Not verified"]);
    const notFound = describeLookup({ kind: "not_found" }, fmt);
    assert.equal(notFound.tone, "unknown");
    assert.equal(notFound.title, "Not verified");
    assert.match(notFound.summary, /isn't a warning/);
  });

  test("dates: verified date when known; validity only while verified or self-declared", () => {
    assert.deepEqual(show({ status: "verified" }).facts, ["Verified 2026-09-14", "Valid until 2026-10-14"]);
    assert.deepEqual(show({ status: "needs_fix" }).facts, []);
  });
});

describe("parseRegistryResponse", () => {
  test("accepts a real response and drops unexpected fields", () => {
    const parsed = parseRegistryResponse({ ...entry(), issuer: { name: "x", url: "y" }, extra: "<script>" });
    assert.deepEqual(parsed, entry());
  });

  test("rejects malformed responses instead of guessing", () => {
    for (const bad of [null, "text", {}, { ...entry(), status: "trusted" }, { ...entry(), verification_id: "abc" }, { ...entry(), verified_at: "yesterday" }]) {
      assert.equal(parseRegistryResponse(bad), null, JSON.stringify(bad));
    }
  });

  test("keeps only well-formed self-declared endpoints", () => {
    const parsed = parseRegistryResponse({ ...entry(), self_declared_endpoints: [{ method: "POST", path: "/c", purpose: "booking" }, { method: 1 }, "x"] });
    assert.deepEqual(parsed?.self_declared_endpoints, [{ method: "POST", path: "/c", purpose: "booking" }]);
  });
});
