import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { INTENT_HEADER } from "./intent";

/**
 * The collectors run on customers' own infrastructure, so what they forward
 * decides what this feature can see at all. A header dropped here is
 * invisible everywhere downstream, which is easy to miss because nothing
 * fails — the data simply never arrives.
 */
const COLLECTORS = ["collectors/cloudflare-worker.js", "collectors/nextjs-proxy.ts"].map((file) => ({
  file,
  source: readFileSync(path.resolve(process.cwd(), file), "utf8"),
}));

describe("collectors forward what classification needs", () => {
  for (const { file, source } of COLLECTORS) {
    test(`${file} forwards the signature and declaration headers`, () => {
      for (const header of ["user-agent", "signature", "signature-input", "signature-agent", INTENT_HEADER]) {
        assert.match(source, new RegExp(`"${header}"`), `${file} must forward ${header}`);
      }
    });

    test(`${file} sends nothing beyond that`, () => {
      // Guards against a well-meaning addition that widens the privacy footprint.
      for (const forbidden of ["cookie", "authorization", "referer", "body", "search"]) {
        assert.doesNotMatch(source, new RegExp(`"${forbidden}"`, "i"), `${file} must not forward ${forbidden}`);
      }
    });
  }
});
