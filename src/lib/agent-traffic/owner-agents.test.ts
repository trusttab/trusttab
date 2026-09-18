import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { describeOwnerAgent, matchOwnerAgent, OWNER_AGENT_LIMIT, validateOwnerAgent, type OwnerAgent } from "./owner-agents";

const agent = (partial: Partial<OwnerAgent>): OwnerAgent => ({
  id: "a1",
  name: "Lead Follow-up Bot",
  matchType: "user_agent",
  matchValue: "MyCompanyBot",
  ...partial,
});

const signals = (partial: Partial<Parameters<typeof matchOwnerAgent>[0]>) => ({
  userAgent: null,
  ip: null,
  headerValue: null,
  ...partial,
});

describe("validateOwnerAgent", () => {
  test("accepts a reasonable registration", () => {
    const result = validateOwnerAgent({ name: " Lead Bot ", matchType: "user_agent", matchValue: " MyCompanyBot " });
    assert.deepEqual(result, { ok: true, value: { name: "Lead Bot", matchType: "user_agent", matchValue: "MyCompanyBot" } });
  });

  test("refuses a user-agent fragment short enough to match ordinary visitors", () => {
    const result = validateOwnerAgent({ name: "Bot", matchType: "user_agent", matchValue: "Mo" });
    assert.equal(result.ok, false);
    assert.match(result.ok === false ? result.error : "", /at least 4 characters/);
  });

  test("checks IPs and ranges are really addresses", () => {
    assert.equal(validateOwnerAgent({ name: "Bot", matchType: "ip", matchValue: "203.0.113.4" }).ok, true);
    assert.equal(validateOwnerAgent({ name: "Bot", matchType: "ip", matchValue: "203.0.113.0/24" }).ok, true);
    assert.equal(validateOwnerAgent({ name: "Bot", matchType: "ip", matchValue: "my-server" }).ok, false);
  });

  test("requires a name and a known match type", () => {
    assert.equal(validateOwnerAgent({ name: "", matchType: "user_agent", matchValue: "MyBot" }).ok, false);
    assert.equal(validateOwnerAgent({ name: "Bot", matchType: "magic", matchValue: "x" }).ok, false);
  });
});

describe("matchOwnerAgent", () => {
  test("matches a user agent by substring, case-insensitively", () => {
    assert.equal(matchOwnerAgent(signals({ userAgent: "Mozilla/5.0 MyCompanyBot/2.1" }), [agent({})])?.name, "Lead Follow-up Bot");
    assert.equal(matchOwnerAgent(signals({ userAgent: "mozilla/5.0 mycompanybot/2.1" }), [agent({})])?.id, "a1");
    assert.equal(matchOwnerAgent(signals({ userAgent: "Mozilla/5.0 Chrome/141" }), [agent({})]), null);
  });

  test("matches a single IP and a range", () => {
    const single = agent({ matchType: "ip", matchValue: "203.0.113.4" });
    assert.equal(matchOwnerAgent(signals({ ip: "203.0.113.4" }), [single])?.id, "a1");
    assert.equal(matchOwnerAgent(signals({ ip: "203.0.113.5" }), [single]), null);

    const range = agent({ matchType: "ip", matchValue: "203.0.113.0/24" });
    assert.equal(matchOwnerAgent(signals({ ip: "203.0.113.200" }), [range])?.id, "a1");
    assert.equal(matchOwnerAgent(signals({ ip: "198.51.100.1" }), [range]), null);
  });

  test("matches the tag header exactly, not by substring", () => {
    const tagged = agent({ matchType: "header", matchValue: "lead-bot" });
    assert.equal(matchOwnerAgent(signals({ headerValue: "lead-bot" }), [tagged])?.id, "a1");
    assert.equal(matchOwnerAgent(signals({ headerValue: " Lead-Bot " }), [tagged])?.id, "a1");
    assert.equal(matchOwnerAgent(signals({ headerValue: "lead-bot-2" }), [tagged]), null);
  });

  test("no signals, or no registered agents, matches nothing", () => {
    assert.equal(matchOwnerAgent(signals({}), [agent({})]), null);
    assert.equal(matchOwnerAgent(signals({ userAgent: "MyCompanyBot" }), []), null);
  });
});

describe("wording", () => {
  test("a match reads as the owner's own label, and says how it was matched", () => {
    const described = describeOwnerAgent(agent({}));
    assert.equal(described.identity, "Your agent: Lead Follow-up Bot");
    assert.match(described.signal, /you registered the user agent/);
  });

  /** This label is the owner's word, not a check. The copy must not borrow the language of verification. */
  test("the limit is stated plainly and never claims verification", () => {
    assert.match(OWNER_AGENT_LIMIT, /a label you set, not something TrustTab verified/);
    assert.match(OWNER_AGENT_LIMIT, /user agent can be copied/);
    assert.doesNotMatch(OWNER_AGENT_LIMIT, /\bverified\b(?!\.)\s(?!it)/i);
  });
});
