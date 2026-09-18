import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

/**
 * The session timeline and the owner's own agent labels are private, per-site
 * dashboard features: not on the public registry, the badge, or anything the
 * extension reads. They rely on the ownership check the dashboard already
 * uses — scope by `sites.userId`, 404 otherwise — so these tests read the
 * source and fail if a surface stops scoping that way.
 */
const read = (file: string) => readFileSync(path.resolve(process.cwd(), file), "utf8");

const OWNER_SCOPED = [
  "src/app/api/sites/[id]/owner-agents/route.ts",
  "src/app/dashboard/[siteId]/page.tsx",
];

describe("owner-only surfaces", () => {
  for (const file of OWNER_SCOPED) {
    test(`${file} scopes to the signed-in owner's site`, () => {
      const source = read(file);
      assert.match(source, /eq\(sites\.userId, user\.id\)/, "must scope the site query by the signed-in user");
      assert.match(source, /notFound\(\)|jsonError\(404/, "must 404 rather than reveal another account's site");
    });
  }

  test("writes to the owner-agent registry also require a same-origin browser request", () => {
    const source = read("src/app/api/sites/[id]/owner-agents/route.ts");
    assert.match(source, /sameOriginBrowserRequestError\(request\)/);
  });

  test("no public surface reads owner agents, the timeline, or site-wide hits", () => {
    // The public registry, badge and manifest endpoints, plus what the extension calls.
    const publicRoutes = [
      "src/app/api/verify/[verificationId]/route.ts",
      "src/app/api/verify/by-domain/[domain]/route.ts",
      "src/app/api/manifest/[domain]/route.ts",
      "src/app/api/badge/[file]/route.ts",
      "src/lib/registry.ts",
    ];
    for (const file of publicRoutes) {
      // Read without a fallback: if a route is renamed, this test must fail
      // loudly rather than quietly stop checking that surface.
      const source = read(file);
      assert.doesNotMatch(source, /ownerAgents|siteAgentHits|getAgentTimeline|getAgentVolume/, `${file} must not read owner-only data`);
    }
  });
});
