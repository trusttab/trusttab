import assert from "node:assert/strict";
import { test } from "node:test";

import {
  AGENT_DISCLAIMER,
  AGENT_TIER_EXAMPLES,
  CITATIONS,
  CITATION_SCOPE_NOTE,
  SECURITY_LIMITS,
  SECURITY_SCOPE,
} from "./audiences";

const allSecurityCopy = [...SECURITY_SCOPE.flatMap((s) => [s.claim, s.body]), SECURITY_LIMITS].join(" ");
const allAgentCopy = [AGENT_DISCLAIMER, ...AGENT_TIER_EXAMPLES.flatMap((t) => [t.agent, t.shown])].join(" ");

/**
 * The scope block is the whole point of /for-security: "governing inbound
 * agent traffic" is one imprecise sentence away from "we do agent governance",
 * which is a different product category this doesn't touch.
 */
test("the security page states all four scope limits", () => {
  const claims = SECURITY_SCOPE.map((s) => s.claim);
  assert.equal(claims.length, 4);
  assert.match(claims.join(" "), /inbound visibility/i);
  assert.match(claims.join(" "), /not agent governance/i);
  assert.match(claims.join(" "), /does not enforce/i);
  assert.match(claims.join(" "), /isn't audit evidence/i);
});

test("the security page names the category it is not, so the boundary is concrete", () => {
  const governance = SECURITY_SCOPE.find((s) => /not agent governance/i.test(s.claim));
  assert.ok(governance);
  assert.match(governance.body, /your own company deploys|deploys itself|own deployed/i);
  // Naming real tools in the other category is what stops the disclaimer being abstract.
  assert.match(governance.body, /Astrix|Entro|Oasis/);
});

test("neither page implies enforcement, which is the unbuilt stage", () => {
  const enforcement = /\b(blocks|throttles|refuses|prevents|stops|quarantines|enforces)\b/i;
  // The one permitted use is the sentence saying it does none of those.
  const denial = SECURITY_SCOPE.find((s) => /does not enforce/i.test(s.claim))!;
  assert.match(denial.body, /Nothing here blocks, throttles, or refuses/);
  for (const text of [...SECURITY_SCOPE.filter((s) => s !== denial).flatMap((s) => [s.claim, s.body]), SECURITY_LIMITS, allAgentCopy]) {
    assert.doesNotMatch(text, enforcement, `no enforcement claim outside the denial: "${text}"`);
  }
});

/**
 * Nothing here can support a compliance claim: self-attestation and heuristic
 * tiers are the opposite of audit evidence, and none of this is certified.
 */
test("neither page uses compliance, certification or enterprise-tier language", () => {
  const forbidden =
    /\bSOC ?2\b|\bISO ?27001\b|\bHIPAA\b|\bFedRAMP\b|\bPCI\b|\bSSO\b|\bSAML\b|\bcertified\b|\bcertification\b|\bcompliant\b|\bguarantee[ds]?\b|\baudit-grade\b|\benterprise (support|tier|plan)\b|\bSLA\b/i;
  for (const text of [allSecurityCopy, allAgentCopy, CITATION_SCOPE_NOTE]) {
    assert.doesNotMatch(text, forbidden, `no compliance language: "${text.slice(0, 80)}…"`);
  }
  // "compliance framework" appears once, in the sentence saying this isn't one.
  const audit = SECURITY_SCOPE.find((s) => /audit evidence/i.test(s.claim))!;
  assert.match(audit.body, /not a control you can point a compliance framework at/);
});

/** CLAUDE.md, "What TrustTab is NOT" — and the reason /for-agents exists at all. */
test("the agents page disclaims issuing identity", () => {
  assert.match(AGENT_DISCLAIMER, /does not issue identity credentials/i);
  assert.match(AGENT_DISCLAIMER, /is not an identity authority/i);
  assert.match(AGENT_DISCLAIMER, /says nothing about how your agent behaves/i);
  assert.doesNotMatch(allAgentCopy, /\b(we issue|we certify|we vouch for|trusted by TrustTab|TrustTab-approved)\b/i);
});

/**
 * Listing is the weaker tier. A page that sold it as equivalent to signing
 * would invert the hierarchy the dashboard is careful about.
 */
test("the agents page keeps listing below signing", () => {
  const listed = AGENT_TIER_EXAMPLES.find((t) => /known-agent list/i.test(t.agent))!;
  const signed = AGENT_TIER_EXAMPLES.find((t) => /^Signed/i.test(t.agent))!;
  assert.equal(listed.strength, "estimate");
  assert.equal(signed.strength, "fact");
  assert.match(listed.shown, /estimate|guess, not proof/i);
  assert.ok(
    AGENT_TIER_EXAMPLES.indexOf(signed) > AGENT_TIER_EXAMPLES.indexOf(listed),
    "signing is shown last, as the strongest",
  );
});

/**
 * Both cited studies measure mostly internally-deployed agents — the category
 * /for-security explicitly does not cover. Citing them without saying so would
 * smuggle the overclaim back in through the statistics.
 */
test("citations carry the note that they measure a broader problem", () => {
  assert.ok(CITATIONS.length > 0);
  assert.match(CITATION_SCOPE_NOTE, /broader problem|deploy themselves|organisations deploy/i);
  assert.match(CITATION_SCOPE_NOTE, /not a claim that TrustTab solves that/i);
});

test("every citation names its source and links to it", () => {
  for (const citation of CITATIONS) {
    assert.match(citation.figure, /^\d+%$/, "a figure, stated as one");
    assert.ok(citation.source.length > 20, `${citation.figure} names its source`);
    assert.match(citation.url, /^https:\/\//, `${citation.figure} links out`);
    assert.match(citation.source, /20\d\d/, `${citation.figure} is dated`);
  }
});

/** Research paid for by a vendor in the space is disclosed as such, not laundered as neutral. */
test("the commissioned study discloses who paid for it", () => {
  const csa = CITATIONS.find((c) => /Cloud Security Alliance/i.test(c.source))!;
  assert.match(csa.disclosure ?? "", /commissioned by Zenity/i);
  assert.match(csa.disclosure ?? "", /not neutral/i);
});
