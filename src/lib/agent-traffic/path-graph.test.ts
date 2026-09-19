import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MAX_GRAPH_EDGES,
  MAX_GRAPH_NODES,
  buildPathGraph,
  describePathGraph,
  nodeLabel,
} from "./path-graph";
import type { TimelineRequest } from "./timeline";

const base = new Date("2026-09-18T10:00:00Z").getTime();

function walk(paths: (string | null)[], outside: number[] = []): TimelineRequest[] {
  return paths.map((path, index) => ({
    at: new Date(base + index * 1000),
    method: "GET",
    path,
    tier: "likely_automated" as const,
    declaredIntent: null,
    scopeMismatch: outside.includes(index) ? ("path-outside-scope" as const) : null,
  }));
}

test("an empty walk is empty", () => {
  assert.equal(buildPathGraph([]).kind, "empty");
  assert.equal(buildPathGraph(walk([null, null])).kind, "empty");
});

test("nodes are in first-visit order and count repeat visits", () => {
  const result = buildPathGraph(walk(["/a", "/b", "/a", "/c"]));
  assert.equal(result.kind, "graph");
  if (result.kind !== "graph") return;
  assert.deepEqual(
    result.graph.nodes.map((n) => [n.path, n.order, n.visits]),
    [
      ["/a", 1, 2],
      ["/b", 2, 1],
      ["/c", 3, 1],
    ],
  );
});

test("edges are the moves between pages, counted, with repeats of one page not drawn as loops", () => {
  const result = buildPathGraph(walk(["/a", "/b", "/a", "/b", "/b"]));
  assert.equal(result.kind, "graph");
  if (result.kind !== "graph") return;
  const edges = result.graph.edges.map((e) => `${e.from}->${e.to}:${e.count}`).sort();
  assert.deepEqual(edges, ["/a->/b:2", "/b->/a:1"]);
  assert.equal(result.counts.requests, 5);
});

test("a page requested outside a declared scope marks its node, however many other visits were fine", () => {
  const result = buildPathGraph(walk(["/ok", "/account", "/account"], [1]));
  assert.equal(result.kind, "graph");
  if (result.kind !== "graph") return;
  const account = result.graph.nodes.find((n) => n.path === "/account");
  assert.equal(account?.outsideScope, true);
  assert.equal(result.graph.nodes.find((n) => n.path === "/ok")?.outsideScope, false);
});

test("layout is deterministic: the same walk lays out identically every time", () => {
  const paths = ["/a", "/b", "/c", "/d", "/b", "/e"];
  const first = buildPathGraph(walk(paths));
  const second = buildPathGraph(walk(paths));
  assert.deepEqual(first, second);
});

test("every node sits inside the drawing", () => {
  const result = buildPathGraph(walk(Array.from({ length: MAX_GRAPH_NODES }, (_, i) => `/page-${i}`)));
  assert.equal(result.kind, "graph");
  if (result.kind !== "graph") return;
  for (const node of result.graph.nodes) {
    assert.ok(node.x > 0 && node.x < result.graph.width, `${node.path} x within width`);
    assert.ok(node.y > 0 && node.y < result.graph.height, `${node.path} y within height`);
  }
});

test("exactly the node limit still draws; one more falls back to text", () => {
  const atLimit = buildPathGraph(walk(Array.from({ length: MAX_GRAPH_NODES }, (_, i) => `/page-${i}`)));
  assert.equal(atLimit.kind, "graph");

  const over = buildPathGraph(walk(Array.from({ length: MAX_GRAPH_NODES + 1 }, (_, i) => `/page-${i}`)));
  assert.equal(over.kind, "too-large");
  if (over.kind !== "too-large") return;
  assert.match(over.reason, new RegExp(`${MAX_GRAPH_NODES + 1} distinct pages`));
  assert.match(over.reason, new RegExp(String(MAX_GRAPH_NODES)));
});

test("too many moves falls back to text even when few pages are involved", () => {
  // 12 pages visited in every ordered pair: well under the node limit, far past
  // the edge limit. This is the tangle node count alone would not catch.
  const pages = Array.from({ length: 12 }, (_, i) => `/p${i}`);
  const paths: string[] = [];
  for (const from of pages) {
    for (const to of pages) {
      if (from !== to) paths.push(from, to);
    }
  }
  const result = buildPathGraph(walk(paths));
  assert.equal(result.kind, "too-large");
  if (result.kind !== "too-large") return;
  assert.ok(result.counts.distinctPaths <= MAX_GRAPH_NODES, "node count is within its limit");
  assert.ok(result.counts.transitions > MAX_GRAPH_EDGES, "edge count is what tripped");
  assert.match(result.reason, /page-to-page moves/);
});

test("the text summary states the walk as numbers, and is there whether or not it drew", () => {
  const drawn = buildPathGraph(walk(["/a", "/b", "/a"]));
  assert.equal(drawn.kind, "graph");
  if (drawn.kind !== "graph") return;
  assert.match(drawn.description, /3 requests across 2 pages/);
  assert.match(drawn.description, /1 move went to a page not requested before, 1 returned/);

  const swept = buildPathGraph(walk(Array.from({ length: 300 }, (_, i) => `/catalog/item-${i}`)));
  assert.equal(swept.kind, "too-large");
  if (swept.kind !== "too-large") return;
  assert.match(swept.description, /300 requests across 300 pages/);
  assert.match(swept.description, /299 moves went to a page not requested before, 0 returned/);
});

test("the busiest pages are listed only when something was actually requested more than once", () => {
  assert.doesNotMatch(describePathGraph(buildPathGraphCounts(["/a", "/b"])), /Most requested/);
  assert.match(describePathGraph(buildPathGraphCounts(["/a", "/b", "/a"])), /Most requested: \/a \(2\)/);
});

function buildPathGraphCounts(paths: string[]) {
  const result = buildPathGraph(walk(paths));
  assert.notEqual(result.kind, "empty");
  if (result.kind === "empty") throw new Error("unreachable");
  return result.counts;
}

test("node labels stay short and never lose the path itself", () => {
  assert.equal(nodeLabel("/catalog/item-1"), "item-1");
  assert.equal(nodeLabel("/"), "/");
  assert.equal(nodeLabel("/a-very-long-single-segment-name"), "a-very-long-si…");
});

/**
 * Same discipline as the rate flag and the declared-intent wording: the walk is
 * evidence the owner reads, never a characterisation of the visitor.
 */
test("nothing in the output characterises the agent", () => {
  const forbidden = /scrap(e|er|ing)|attack|malicious|abuse|steal|hostile|suspicious/i;
  const cases = [
    buildPathGraph(walk(["/a", "/b", "/a"])),
    buildPathGraph(walk(Array.from({ length: 300 }, (_, i) => `/catalog/item-${i}`))),
  ];
  for (const result of cases) {
    if (result.kind === "empty") continue;
    assert.doesNotMatch(result.description, forbidden);
    if (result.kind === "too-large") assert.doesNotMatch(result.reason, forbidden);
  }
});
