import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { AGENT_RANGES, ipInCidr, matchAgentRange, parseIp, RANGES_RETRIEVED } from "./ip-match";

describe("parseIp and ipInCidr", () => {
  test("IPv4, including mapped form", () => {
    assert.deepEqual(parseIp("203.0.113.7")?.parts, [203, 0, 113, 7]);
    assert.deepEqual(parseIp("::ffff:203.0.113.7")?.parts, [203, 0, 113, 7]);
    assert.equal(parseIp("not an ip"), null);
    assert.equal(parseIp("300.1.1.1"), null);
  });

  test("IPv4 prefixes", () => {
    assert.equal(ipInCidr("203.0.113.7", "203.0.113.0/24"), true);
    assert.equal(ipInCidr("203.0.114.7", "203.0.113.0/24"), false);
    assert.equal(ipInCidr("203.0.113.7", "203.0.113.7/32"), true);
    assert.equal(ipInCidr("1.2.3.4", "0.0.0.0/0"), true);
    // A /23 spans two /24s: checks partial-byte prefixes.
    assert.equal(ipInCidr("198.51.101.9", "198.51.100.0/23"), true);
    assert.equal(ipInCidr("198.51.102.9", "198.51.100.0/23"), false);
  });

  test("IPv6 prefixes, including compressed forms", () => {
    assert.equal(ipInCidr("2600:1f18:1::5", "2600:1f18::/32"), true);
    assert.equal(ipInCidr("2600:1f19:1::5", "2600:1f18::/32"), false);
    assert.equal(ipInCidr("2001:db8::1", "2001:db8::/48"), true);
    // Families never cross-match.
    assert.equal(ipInCidr("203.0.113.7", "2001:db8::/32"), false);
    assert.equal(ipInCidr("2001:db8::1", "203.0.113.0/24"), false);
  });
});

describe("published agent ranges", () => {
  test("the committed file covers the operators that publish ranges", () => {
    const operators = new Set(AGENT_RANGES.map((r) => r.operator));
    for (const expected of ["OpenAI", "Google", "Perplexity"]) assert.ok(operators.has(expected), expected);
    assert.match(RANGES_RETRIEVED, /^\d{4}-\d{2}-\d{2}$/);
    for (const entry of AGENT_RANGES) {
      assert.ok(entry.prefixes.length > 0, entry.product);
      for (const prefix of entry.prefixes) assert.match(prefix, /^[0-9a-f.:]+\/\d{1,3}$/i, prefix);
    }
  });

  test("an address inside a published prefix matches its operator, and an unrelated one doesn't", () => {
    const [entry] = AGENT_RANGES;
    const [prefix] = entry.prefixes;
    const [network] = prefix.split("/");
    assert.equal(matchAgentRange(network)?.operator, entry.operator);
    // Documentation ranges (RFC 5737) belong to nobody.
    assert.equal(matchAgentRange("203.0.113.7"), null);
    assert.equal(matchAgentRange("not an ip"), null);
  });
});
