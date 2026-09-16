import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { SPOOFED_BRANDS } from "./lookalike-brands";
import { checkLookalike, decodePunycode, describeLookalike, editDistance, normalizeConfusables, registrableDomain } from "./lookalike";

describe("helpers", () => {
  test("registrableDomain handles multi-part suffixes", () => {
    assert.equal(registrableDomain("www.paypal.com")?.domain, "paypal.com");
    assert.equal(registrableDomain("shop.amazon.co.uk")?.domain, "amazon.co.uk");
    assert.equal(registrableDomain("localhost"), null);
    assert.equal(registrableDomain("192.168.0.1"), null);
  });

  test("decodePunycode decodes homoglyph domains and leaves plain labels alone", () => {
    assert.equal(decodePunycode("xn--pypal-4ve"), "pаypal"); // Cyrillic а
    assert.equal(decodePunycode("paypal"), "paypal");
    assert.equal(decodePunycode("xn--not-valid-$$"), "xn--not-valid-$$");
  });

  test("normalizeConfusables maps digits, letter pairs and Cyrillic to Latin", () => {
    assert.equal(normalizeConfusables("paypa1"), "paypal");
    assert.equal(normalizeConfusables("arnazon"), "amazon");
    assert.equal(normalizeConfusables("pаypal"), "paypal");
    assert.equal(editDistance("paypal", "paypa"), 1);
    assert.equal(editDistance("paypal", "papyal"), 1); // transposition
  });
});

describe("checkLookalike", () => {
  test("the brand's own domains and subdomains never fire", () => {
    for (const host of ["paypal.com", "www.paypal.com", "signin.paypal.com", "amazon.co.uk", "icloud.com", "chase.com"]) {
      assert.equal(checkLookalike(host), null, host);
    }
  });

  test("character substitution and homoglyphs fire", () => {
    const cases: [string, string][] = [
      ["paypa1.com", "PayPal"],
      ["arnazon.com", "Amazon"],
      ["xn--pypal-4ve.com", "PayPal"],
      ["netfl1x.com", "Netflix"],
      ["micros0ft.com", "Microsoft"],
    ];
    for (const [host, brand] of cases) {
      const finding = checkLookalike(host);
      assert.equal(finding?.brand, brand, host);
      assert.equal(finding?.kind, "character-substitution", host);
      assert.match(describeLookalike(finding!), /isn't the same domain/);
    }
  });

  test("near-miss endings fire", () => {
    const finding = checkLookalike("paypal.co");
    assert.equal(finding?.kind, "lookalike-ending");
    assert.equal(finding?.brand, "PayPal");
    assert.match(describeLookalike(finding!), /different ending/);
  });

  test("the brand's name inside someone else's domain fires", () => {
    for (const host of ["paypal-secure.com", "secure-paypal.net", "paypal.com.login-check.net", "netflix-billing.info"]) {
      const finding = checkLookalike(host);
      assert.equal(finding?.kind, "brand-in-other-domain", host);
      assert.match(describeLookalike(finding!), /contains .*'s name but isn't/);
    }
  });

  test("ordinary domains and word-like brand names don't fire", () => {
    for (const host of [
      "example.com",
      "leasetab.com",
      "trusttab-mu.vercel.app",
      "apple-pie-recipes.com", // "apple" is a common word: name-in-domain doesn't apply
      "target-practice.org",
      "chase-the-sun.blog",
      "steam-cleaning-services.co.uk",
      "visa-application-help.com",
      "en.wikipedia.org",
      "my-shop.myshopify.com",
    ]) {
      assert.equal(checkLookalike(host), null, host);
    }
  });

  test("brand list entries are well-formed", () => {
    const tokens = new Set<string>();
    for (const brand of SPOOFED_BRANDS) {
      assert.ok(brand.domains.length > 0, brand.name);
      assert.ok(!tokens.has(brand.token), `duplicate token ${brand.token}`);
      tokens.add(brand.token);
      for (const domain of brand.domains) assert.match(domain, /^[a-z0-9-]+(\.[a-z0-9-]+)+$/, domain);
      assert.match(brand.token, /^[a-z0-9]+$/, brand.token);
    }
  });
});
