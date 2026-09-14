import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { summarizeOutcome } from "./outcome";
import type { CheckDetail, CheckId, CheckResult } from "./types";

const check = (id: CheckId, passed: boolean, details: CheckDetail[] = []): CheckResult => ({
  id,
  label: id,
  passed,
  message: "",
  details,
});
const ok = (subject: string): CheckDetail => ({ subject, passed: true, message: "" });
const fail = (subject: string): CheckDetail => ({ subject, passed: false, message: "" });
const selfDeclared = (subject: string): CheckDetail => ({ subject, passed: false, selfDeclared: true, message: "" });

const others = (passed = true) => [
  check("injection_scan", passed),
  check("ssl", true),
  check("domain_match", true),
  check("expiry", true),
];

describe("summarizeOutcome", () => {
  test("everything passes automatically → verified", () => {
    const r = summarizeOutcome([check("endpoint_match", true, [ok("POST /a"), ok("POST /b")]), ...others()]);
    assert.deepEqual(r, { status: "verified", endpointVerifiedBy: ["issuer", "issuer"] });
  });

  test("some endpoints self-declared, everything else passes → self_declared", () => {
    const r = summarizeOutcome([check("endpoint_match", false, [ok("POST /a"), selfDeclared("POST /b")]), ...others()]);
    assert.deepEqual(r, { status: "self_declared", endpointVerifiedBy: ["issuer", "owner"] });
  });

  test("self-attestation can't make up for a failed non-endpoint check", () => {
    const r = summarizeOutcome([check("endpoint_match", false, [selfDeclared("POST /b")]), ...others(false)]);
    assert.equal(r.status, "unverified");
    assert.deepEqual(r.endpointVerifiedBy, ["owner"]);
  });

  test("an endpoint that neither passed nor is self-declared → unverified", () => {
    const r = summarizeOutcome([check("endpoint_match", false, [selfDeclared("POST /a"), fail("POST /b")]), ...others()]);
    assert.deepEqual(r, { status: "unverified", endpointVerifiedBy: ["owner", null] });
  });
});
