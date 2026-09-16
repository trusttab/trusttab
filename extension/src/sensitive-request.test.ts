import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { findSensitiveRequest, SENSITIVE_REQUEST_PATTERNS, URGENCY_PATTERNS } from "./sensitive-request";

describe("findSensitiveRequest", () => {
  test("fires only when a credential request and urgency appear in the same block", () => {
    const block = "Support: Your account will be suspended in 15 minutes. Please confirm your one-time verification code to keep access.";
    const finding = findSensitiveRequest([block]);
    assert.deepEqual(finding?.requested, ["one-time verification code"]);
    assert.ok(finding!.urgency.includes("account suspension or closure"));
    assert.match(finding!.quote, /confirm your one-time verification code/);
    // The quote is the page's own words, starting at a word boundary.
    const inner = finding!.quote.replace(/^…|…$/g, "");
    const at = block.indexOf(inner);
    assert.ok(at >= 0, finding!.quote);
    assert.ok(at === 0 || block[at - 1] === " ", `starts mid-word: ${finding!.quote}`);
  });

  test("a long block is quoted around the match, cut at word boundaries", () => {
    const filler = "We are contacting all customers about a routine review of recent transactions on their accounts. ".repeat(3);
    const finding = findSensitiveRequest([`${filler}Your account will be locked today. Please enter your password to continue.`]);
    assert.ok(finding!.quote.startsWith("…"), finding!.quote);
    assert.ok(finding!.quote.length <= 170, String(finding!.quote.length));
    assert.doesNotMatch(finding!.quote, /\s…$/);
  });

  test("a request without urgency, or urgency without a request, doesn't fire", () => {
    assert.equal(findSensitiveRequest(["Please enter your password to sign in to your account."]), null);
    assert.equal(findSensitiveRequest(["Limited time offer! Only 3 seats left, act now before this deal expires today."]), null);
    assert.equal(findSensitiveRequest(["Enter your email address to get our newsletter. Offer ends in 2 hours!"]), null);
  });

  test("urgency and a request in different blocks don't combine", () => {
    assert.equal(
      findSensitiveRequest(["Your account will be suspended immediately unless you respond.", "Enter your password on the sign-in page."]),
      null,
    );
  });

  test("security warnings about these requests are not requests", () => {
    for (const block of [
      "Security notice: we will never ask for your password or verification code, and your account will never be suspended for ignoring such a message.",
      "Beware of phishing: scammers may ask you to share your card number urgently to avoid account closure.",
      "Never share your one-time code with anyone, even if they say your account will be locked immediately.",
    ]) {
      assert.equal(findSensitiveRequest([block]), null, block.slice(0, 40));
    }
  });

  test("normal business language stays clear", () => {
    for (const block of [
      "Enter your name and email to book a viewing. We reply within 2 hours.",
      "Final notice: your subscription renews tomorrow. Update your card details in your account settings when convenient.",
      "Act now — spring sale ends Sunday. Free delivery on all orders.",
      "To reset your password, use the link we email you. Never give your password to anyone.",
    ]) {
      assert.equal(findSensitiveRequest([block]), null, block.slice(0, 40));
    }
  });

  test("catches the other credential shapes", () => {
    const cases: [string, string][] = [
      ["Verify your full card number and CVV now to avoid suspension of your account.", "full card number"],
      ["To prevent account closure, provide your Social Security number immediately.", "Social Security number"],
      ["Your wallet is at risk. Share your recovery phrase right now to secure your funds.", "crypto wallet recovery phrase or private key"],
      ["Your account is locked. Install AnyDesk immediately so our agent can fix it.", "remote access to your device"],
    ];
    for (const [text, label] of cases) {
      const finding = findSensitiveRequest([text]);
      assert.ok(finding?.requested.includes(label), `${label}: ${JSON.stringify(finding)}`);
    }
  });

  test("pattern lists are non-empty and uniquely identified", () => {
    for (const list of [SENSITIVE_REQUEST_PATTERNS, URGENCY_PATTERNS]) {
      assert.ok(list.length > 0);
      assert.equal(new Set(list.map((p) => p.id)).size, list.length);
      for (const { label } of list) assert.ok(label.length > 0);
    }
  });
});
