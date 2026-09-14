import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { anonymizeIp, clientIp } from "./ip";

describe("anonymizeIp", () => {
  const cases: [string, string | null][] = [
    ["203.0.113.97", "203.0.113.0"],
    ["::ffff:198.51.100.7", "198.51.100.0"],
    ["2001:db8:85a3:8d3:1319:8a2e:370:7348", "2001:db8:85a3::"],
    ["2001:db8::1", "2001:db8:0::"],
    ["2001:0db8:0000:0042::1", "2001:db8:0::"],
    ["::1", "0:0:0::"],
    ["fe80::", "fe80:0:0::"],
    ["not an ip", null],
  ];
  for (const [input, expected] of cases) {
    test(`${input} → ${expected}`, () => assert.equal(anonymizeIp(input), expected));
  }
});

describe("clientIp", () => {
  const req = (headers: Record<string, string>) => new Request("https://x.test/", { headers });
  test("uses the first x-forwarded-for entry", () => {
    assert.equal(clientIp(req({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" })), "203.0.113.9");
  });
  test("falls back to x-real-ip", () => {
    assert.equal(clientIp(req({ "x-real-ip": "2001:db8::5" })), "2001:db8::5");
  });
  test("ignores values that aren't IPs", () => {
    assert.equal(clientIp(req({ "x-forwarded-for": "<script>, 1.2.3.4" })), null);
    assert.equal(clientIp(req({})), null);
  });
});
