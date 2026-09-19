import assert from "node:assert/strict";
import { test } from "node:test";

import { EXPIRY_WARNING_DAYS, summarizeSite, type SiteSummaryInput } from "./summary";
import type { CheckDetail, CheckId, CheckResult } from "./types";

const now = new Date("2026-09-18T12:00:00Z");
const days = (n: number) => new Date(now.getTime() + n * 86_400_000);

const check = (id: CheckId, passed: boolean, details: CheckDetail[] = []): CheckResult => ({
  id,
  label: id,
  passed,
  message: "technical message",
  details,
});

const allPassed: CheckResult[] = [
  check("endpoint_match", true),
  check("injection_scan", true),
  check("ssl", true),
  check("domain_match", true),
  check("expiry", true),
];

const input = (over: Partial<SiteSummaryInput> = {}): SiteSummaryInput => ({
  status: "verified",
  ownershipVerified: true,
  hasManifest: true,
  expiresAt: days(30),
  lastRunAt: days(-1),
  checks: allPassed,
  now,
  ...over,
});

test("ownership comes first: nothing else is asked for until the site is claimed", () => {
  const summary = summarizeSite(input({ ownershipVerified: false, hasManifest: false, checks: [], lastRunAt: null }));
  assert.match(summary.headline, /Confirm this site is yours/);
  assert.equal(summary.badgeText, null);
  assert.deepEqual(summary.actions.map((a) => a.target), ["ownership"]);
});

test("owned but nothing declared asks for the forms, not for a check", () => {
  const summary = summarizeSite(input({ hasManifest: false, checks: [], lastRunAt: null }));
  assert.deepEqual(summary.actions.map((a) => a.target), ["forms"]);
});

test("published but never checked says so rather than implying a result", () => {
  const summary = summarizeSite(input({ status: "pending", checks: [], lastRunAt: null }));
  assert.match(summary.headline, /Ready to be checked/);
  assert.equal(summary.badgeText, "Not verified");
  assert.deepEqual(summary.actions.map((a) => a.target), ["checks"]);
});

test("verified says so, with nothing to do", () => {
  const summary = summarizeSite(input());
  assert.equal(summary.headline, "Your site is verified");
  assert.equal(summary.tone, "good");
  assert.equal(summary.badgeText, "Verified");
  assert.deepEqual(summary.actions, []);
});

test("self-declared is never described as verified, and says how many forms and why", () => {
  const summary = summarizeSite(
    input({
      status: "self_declared",
      checks: [
        check("endpoint_match", false, [
          { subject: "POST /contact", passed: false, message: "not found", selfDeclared: true },
          { subject: "POST /book", passed: false, message: "not found", selfDeclared: true },
        ]),
        ...allPassed.slice(1),
      ],
    }),
  );
  assert.equal(summary.badgeText, "Self-declared");
  assert.equal(summary.tone, "info");
  assert.match(summary.detail, /2 forms/);
  assert.match(summary.detail, /JavaScript/);
  assert.doesNotMatch(summary.headline, /verified/i);
  // Self-attestation is not a failure, so it doesn't generate a task.
  assert.deepEqual(summary.actions, []);
});

test("a failed check is stated as what happened plus what to do about it", () => {
  const summary = summarizeSite(
    input({
      status: "needs_fix",
      checks: [check("endpoint_match", false, [{ subject: "POST /contact", passed: false, message: "no form" }]), ...allPassed.slice(1)],
    }),
  );
  assert.equal(summary.headline, "One check didn't pass");
  assert.equal(summary.tone, "bad");
  assert.match(summary.detail, /couldn't find one of the forms/);
  assert.match(summary.detail, /POST \/contact/);
  assert.equal(summary.actions.length, 1);
  assert.match(summary.actions[0].text, /self-declared/);
});

test("several failures are counted, and each gets its own task", () => {
  const summary = summarizeSite(
    input({
      status: "failed",
      checks: [
        check("endpoint_match", false, [{ subject: "POST /contact", passed: false, message: "no form" }]),
        check("injection_scan", false, [{ subject: "https://example.com/deals", passed: false, message: "hidden text" }]),
        ...allPassed.slice(2),
      ],
    }),
  );
  assert.equal(summary.headline, "2 checks didn't pass");
  assert.match(summary.detail, /1 other check also didn't pass/);
  assert.equal(summary.actions.length, 2);
});

test("expiry is a deadline added to the result, not a replacement for it", () => {
  const soon = summarizeSite(input({ expiresAt: days(EXPIRY_WARNING_DAYS - 1) }));
  assert.equal(soon.headline, "Your site is verified");
  assert.equal(soon.tone, "good");
  assert.match(soon.detail, /It expires on/);
  assert.equal(soon.actions.length, 1);

  const later = summarizeSite(input({ expiresAt: days(EXPIRY_WARNING_DAYS + 5) }));
  assert.deepEqual(later.actions, []);
  assert.doesNotMatch(later.detail, /expires on/);
});

test("an expired site is not presented as fine, even when every check passed", () => {
  const summary = summarizeSite(input({ expiresAt: days(-2) }));
  assert.equal(summary.tone, "bad");
  assert.match(summary.detail, /has expired/);
  assert.match(summary.actions[0].text, /renew/i);
});

/**
 * The point of this summary is that a non-technical owner reads it first, so
 * the vocabulary of the panels below it must not leak into it.
 */
test("the summary avoids the dashboard's technical vocabulary", () => {
  const jargon = /\bmanifest\b|\bJSON\b|\bendpoint\b|\bpayload\b|\bheader\b|\bTLS\b|\bHTTP\b(?!S)|\bschema\b|\bAPI\b|\bJWS\b|\b4\d\d\b/i;
  const cases: SiteSummaryInput[] = [
    input({ ownershipVerified: false }),
    input({ hasManifest: false }),
    input({ status: "pending", checks: [], lastRunAt: null }),
    input(),
    input({ expiresAt: days(-1) }),
    input({ status: "self_declared", checks: [check("endpoint_match", false, [{ subject: "POST /c", passed: false, message: "x", selfDeclared: true }]), ...allPassed.slice(1)] }),
    ...(["endpoint_match", "injection_scan", "ssl", "domain_match", "expiry"] as CheckId[]).map((id) =>
      input({ status: "needs_fix", checks: [check(id, false, [{ subject: "POST /contact", passed: false, message: "x" }]), ...allPassed.slice(1)] }),
    ),
  ];
  for (const c of cases) {
    const summary = summarizeSite(c);
    for (const text of [summary.headline, summary.detail, ...summary.actions.map((a) => a.text)]) {
      assert.doesNotMatch(text, jargon, `plain language: ${text}`);
    }
  }
});

test("every failing check produces a task, so the owner is never told only that something is wrong", () => {
  for (const id of ["endpoint_match", "injection_scan", "ssl", "domain_match", "expiry"] as CheckId[]) {
    const summary = summarizeSite(
      input({ status: "needs_fix", checks: [check(id, false, [{ subject: "POST /contact", passed: false, message: "x" }]), ...allPassed.slice(1)] }),
    );
    assert.ok(summary.actions.length >= 1, `${id} produces an action`);
    assert.ok(summary.detail.length > 20, `${id} explains itself`);
  }
});
