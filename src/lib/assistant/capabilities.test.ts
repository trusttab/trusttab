import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

/**
 * Structural guarantees for the dashboard assistant (see
 * src/lib/publish-gate.ts): it must never be able to sign or publish a
 * manifest. These tests read source files only (no database or network), so
 * they run everywhere and fail the build if a future change breaks the rule.
 */

const SRC = path.resolve(process.cwd(), "src");
const ASSISTANT_DIR = path.join(SRC, "lib/assistant");
const ASSISTANT_ROUTE = path.join(SRC, "app/api/sites/[id]/assistant/route.ts");

/** Files that can sign or publish. None may be reachable from the assistant. */
const FORBIDDEN = [
  "lib/manifest/signing.ts",
  "lib/manifest/store.ts",
  "lib/publish-gate.ts",
  "app/api/sites/[id]/manifest/route.ts",
  "app/api/sites/[id]/publish/confirm/route.ts",
  "app/api/sites/[id]/verify/route.ts",
].map((f) => path.join(SRC, f));

/** The complete, reviewed tool allowlist. Changing it must be deliberate. */
const EXPECTED_TOOLS = [
  "get_site_overview",
  "crawl_site_forms",
  "add_endpoint",
  "update_endpoint",
  "remove_endpoint",
  "set_rate_limit",
  "preview_checks",
  "propose_domain_claim",
];

function resolveImport(from: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) base = path.join(SRC, specifier.slice(2));
  else if (specifier.startsWith(".")) base = path.resolve(path.dirname(from), specifier);
  else return null; // package import
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
    if (existsSync(candidate) && candidate.match(/\.(ts|tsx)$/)) return candidate;
  }
  return null;
}

function importsOf(file: string): string[] {
  const source = readFileSync(file, "utf8");
  const specifiers = [...source.matchAll(/(?:import|export)\s[^'"]*?from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|import\s+["']([^"']+)["']/g)].map(
    (m) => m[1] ?? m[2] ?? m[3],
  );
  return specifiers.map((s) => resolveImport(file, s)).filter((f): f is string => f !== null);
}

/** Every source file transitively imported from `entries`, including type-only imports. */
function importGraph(entries: string[]): Set<string> {
  const seen = new Set<string>();
  const queue = [...entries];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    queue.push(...importsOf(file));
  }
  return seen;
}

const assistantEntries = [
  ...readdirSync(ASSISTANT_DIR)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((f) => path.join(ASSISTANT_DIR, f)),
  ASSISTANT_ROUTE,
];

describe("dashboard assistant capabilities", () => {
  test("the assistant's import graph never reaches code that signs or publishes", () => {
    const graph = importGraph(assistantEntries);
    const reached = FORBIDDEN.filter((f) => graph.has(f)).map((f) => path.relative(SRC, f));
    assert.deepEqual(reached, [], `Assistant code can reach: ${reached.join(", ")}`);
    // Sanity-check the walker actually followed imports into shared code.
    assert.ok(graph.has(path.join(SRC, "lib/verification/engine.ts")));
    assert.ok(graph.has(path.join(SRC, "lib/drafts/index.ts")));
  });

  test("the assistant's code never references the signing key or signing functions", () => {
    const graph = importGraph(assistantEntries);
    for (const file of graph) {
      const source = readFileSync(file, "utf8");
      assert.doesNotMatch(source, /TRUSTTAB_SIGNING_PRIVATE_KEY|signManifest\s*\(|createPrivateKey|insertManifestVersion/, path.relative(SRC, file));
    }
  });

  test("the tool allowlist is exactly the reviewed set, with nothing that publishes", () => {
    const source = readFileSync(path.join(ASSISTANT_DIR, "tools.ts"), "utf8");
    const definitions = source.slice(source.indexOf("export const TOOL_DEFINITIONS"), source.indexOf("const HANDLERS"));
    const names = [...definitions.matchAll(/^\s{4}name: "([a-z_]+)",$/gm)].map((m) => m[1]);
    assert.deepEqual(names, EXPECTED_TOOLS);
    for (const name of names) assert.doesNotMatch(name, /publish|sign|confirm|key|recheck|re_check|verify|pledge/);

    const handlers = source.slice(source.indexOf("const HANDLERS"), source.indexOf("/** Tool names"));
    const handlerNames = [...handlers.matchAll(/^\s{2}async ([a-z_]+)\(/gm)].map((m) => m[1]);
    assert.deepEqual(handlerNames, EXPECTED_TOOLS);
  });

  test("the publish route accepts no manifest content, only a reviewed draft hash and confirmation", () => {
    const source = readFileSync(path.join(SRC, "app/api/sites/[id]/manifest/route.ts"), "utf8");
    assert.match(source, /sameOriginBrowserRequestError\(request\)/);
    assert.match(source, /consumePublishConfirmation\(/);
    assert.match(source, /draftHash\(input\) !== reviewedHash/);
    assert.doesNotMatch(source, /body\.(endpoints|input|manifest)/);
  });
});

describe("AI Check estimate capabilities (text and image)", () => {
  const entries = [
    ...["lib/ai-text", "lib/ai-image", "lib/ai-check"].flatMap((dir) =>
      readdirSync(path.join(SRC, dir))
        .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
        .map((f) => path.join(SRC, dir, f)),
    ),
    path.join(SRC, "app/api/ai-check/text/route.ts"),
    path.join(SRC, "app/api/ai-check/image/route.ts"),
  ];

  test("its import graph never reaches code that signs or publishes", () => {
    const graph = importGraph(entries);
    const reached = FORBIDDEN.filter((f) => graph.has(f)).map((f) => path.relative(SRC, f));
    assert.deepEqual(reached, [], `AI Check code can reach: ${reached.join(", ")}`);
  });

  test("page text and images are never written to the traffic log or other tables, or logged", () => {
    for (const file of importGraph(entries)) {
      if (file.endsWith("lib/rate-limit.ts") || file.endsWith("db/index.ts") || file.endsWith("db/schema.ts") || file.endsWith("lib/ip.ts")) continue;
      const source = readFileSync(file, "utf8");
      assert.doesNotMatch(source, /recordHit|manifestHits|db\.insert|db\.update|console\.\w+\([^)]*[,(]\s*(text|rawText|raw|body|request|bytes|jpeg)\b/, path.relative(SRC, file));
    }
  });
});

