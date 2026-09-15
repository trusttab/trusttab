import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { loginPath, safeNextPath } from "./next-path";

describe("safeNextPath", () => {
  test("keeps same-site paths with their query and hash", () => {
    assert.equal(safeNextPath("/dashboard/open?domain=leasetab.com"), "/dashboard/open?domain=leasetab.com");
    assert.equal(safeNextPath("/dashboard/abc#manifest"), "/dashboard/abc#manifest");
  });

  test("refuses anything that could leave the site", () => {
    for (const bad of [
      "https://evil.example/",
      "//evil.example/path",
      "/\\evil.example",
      "\\\\evil.example",
      "javascript:alert(1)",
      "evil.example",
      "/%0d%0aLocation: https://evil.example".replace("%0d%0a", "\r\n"),
      "",
      null,
      42,
      "/" + "a".repeat(2001),
    ]) {
      assert.equal(safeNextPath(bad), "/dashboard", JSON.stringify(bad));
    }
  });

  test("avoids loops back into auth pages", () => {
    for (const loop of ["/login", "/login?next=/dashboard", "/signup", "/email-verified?next=/x", "/reset-password?token=abc"]) {
      assert.equal(safeNextPath(loop), "/dashboard", loop);
    }
  });

  test("normalizes dot segments without escaping the site", () => {
    assert.equal(safeNextPath("/dashboard/../account"), "/account");
  });
});

describe("loginPath", () => {
  test("adds an encoded next only when it isn't the default", () => {
    assert.equal(loginPath("/dashboard"), "/login");
    assert.equal(loginPath("/dashboard/open?domain=leasetab.com"), "/login?next=%2Fdashboard%2Fopen%3Fdomain%3Dleasetab.com");
    assert.equal(loginPath("//evil.example"), "/login");
  });
});
