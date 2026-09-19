import type { TimelineRequest } from "./timeline";

/**
 * The path a single agent walked through a site: which pages it visited and
 * in what order.
 *
 * This is deliberately one agent at a time. A multi-entity relationship graph
 * smears exactly the signal worth seeing (AGENT_TRAFFIC_DETECTION_SPEC), while
 * one agent's walk has a readable shape that the chronological table doesn't
 * show: a directory swept in order looks nothing like a session that returns
 * to the same few pages, and both look like a flat list of rows.
 *
 * Layout is computed here rather than by a graph library on purpose. A general
 * force-directed layout is a physics simulation: heavy, client-side, and
 * non-deterministic, so the same data draws differently on every load. This
 * isn't a general graph — it's a walk with a known visit order, so placement is
 * a sort and some arithmetic, it renders as server-side SVG with no client
 * JavaScript, and identical data always produces an identical picture.
 *
 * Nothing here characterises intent. Order and breadth are facts; what they
 * mean is the owner's call, the same discipline as the rate flag next to it.
 */

/**
 * Above either of these the drawing stops being readable, so the text summary
 * is shown instead.
 *
 * Both are needed, and node count alone is the wrong test: 40 pages visited
 * once each is a clean chain of 39 moves, while 40 pages revisited in every
 * combination is several hundred overlapping arcs at the same node count. The
 * edge limit is what actually catches a tangle.
 */
export const MAX_GRAPH_NODES = 40;
export const MAX_GRAPH_EDGES = 120;

export type PathNode = {
  path: string;
  /** Position in first-visit order, 1-based, as drawn inside the node. */
  order: number;
  visits: number;
  /** True if any request for this path fell outside the agent's declared scope. */
  outsideScope: boolean;
  x: number;
  y: number;
};

export type PathEdge = {
  from: string;
  to: string;
  /** How many times the agent moved from `from` straight to `to`. */
  count: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Control point for the arc, so opposite directions don't overlap. */
  cx: number;
  cy: number;
};

export type PathGraph = {
  nodes: PathNode[];
  edges: PathEdge[];
  width: number;
  height: number;
};

export type PathGraphCounts = {
  requests: number;
  distinctPaths: number;
  /** Distinct page-to-page moves, which is what the drawing has to fit. */
  transitions: number;
  /** Moves to a page this agent hadn't requested before in this window. */
  movesToNewPage: number;
  /** Moves back to a page it had already requested. */
  movesToSeenPage: number;
  /** The most-requested pages, busiest first. */
  busiest: { path: string; visits: number }[];
};

export type PathGraphResult =
  | { kind: "empty" }
  | {
      kind: "graph";
      graph: PathGraph;
      counts: PathGraphCounts;
      description: string;
    }
  | {
      kind: "too-large";
      counts: PathGraphCounts;
      reason: string;
      description: string;
    };

const NODE_RADIUS = 17;
const CELL_WIDTH = 116;
const CELL_HEIGHT = 92;
const PADDING = 30;
/** Room under a node's centre for its label and repeat count. */
const LABEL_SPACE = 48;

/** Places nodes on a grid in first-visit order, so a page-by-page sweep reads left to right. */
function layout(
  paths: { path: string; visits: number; outsideScope: boolean }[],
): PathGraph {
  const columns = Math.max(1, Math.min(7, Math.ceil(Math.sqrt(paths.length))));
  const rows = Math.ceil(paths.length / columns);
  const nodes: PathNode[] = paths.map((entry, index) => ({
    ...entry,
    order: index + 1,
    x: PADDING + (index % columns) * CELL_WIDTH + CELL_WIDTH / 2,
    y: PADDING + Math.floor(index / columns) * CELL_HEIGHT + NODE_RADIUS,
  }));
  return {
    nodes,
    edges: [],
    width: PADDING * 2 + columns * CELL_WIDTH,
    // Only the last row's node, label and repeat-count need room below it —
    // a full cell height would leave a band of empty space under the drawing.
    height: PADDING * 2 + (rows - 1) * CELL_HEIGHT + NODE_RADIUS + LABEL_SPACE,
  };
}

/** Truncates a path for display under a node; the full path stays in the node's tooltip. */
export function nodeLabel(path: string): string {
  const trimmed = path.replace(/\/+$/, "") || "/";
  const segments = trimmed.split("/");
  const last = segments[segments.length - 1] || "/";
  return last.length > 15 ? `${last.slice(0, 14)}…` : last;
}

function counted(requests: TimelineRequest[]): {
  paths: { path: string; visits: number; outsideScope: boolean }[];
  /** from → (to → how many times). Nested rather than one joined key, because a path may contain any character. */
  moves: Map<string, Map<string, number>>;
  counts: PathGraphCounts;
} {
  const paths: { path: string; visits: number; outsideScope: boolean }[] = [];
  const index = new Map<string, number>();
  const moves = new Map<string, Map<string, number>>();
  let previous: string | null = null;
  let movesToNewPage = 0;
  let movesToSeenPage = 0;
  let requestCount = 0;

  for (const request of requests) {
    const path = request.path;
    if (!path) continue;
    requestCount++;
    const existing = index.get(path);
    const isNew = existing === undefined;
    if (isNew) {
      index.set(path, paths.length);
      paths.push({ path, visits: 1, outsideScope: request.scopeMismatch !== null });
    } else {
      paths[existing].visits++;
      if (request.scopeMismatch !== null) paths[existing].outsideScope = true;
    }
    // A repeated request for the same page in a row is a second visit to that
    // node, not a move; drawing it as a loop adds nothing.
    if (previous !== null && previous !== path) {
      let out = moves.get(previous);
      if (!out) moves.set(previous, (out = new Map()));
      out.set(path, (out.get(path) ?? 0) + 1);
      if (isNew) movesToNewPage++;
      else movesToSeenPage++;
    }
    previous = path;
  }

  const busiest = paths
    .slice()
    .sort((a, b) => b.visits - a.visits || a.path.localeCompare(b.path))
    .slice(0, 3)
    .map(({ path, visits }) => ({ path, visits }));

  return {
    paths,
    moves,
    counts: {
      requests: requestCount,
      distinctPaths: paths.length,
      transitions: Array.from(moves.values()).reduce(
        (total, out) => total + out.size,
        0,
      ),
      movesToNewPage,
      movesToSeenPage,
      busiest,
    },
  };
}

/**
 * States the same walk in words. Used as the drawing's description for screen
 * readers, and on its own when the walk is too big to draw.
 */
export function describePathGraph(counts: PathGraphCounts): string {
  if (counts.requests === 0) return "No requests with a recorded path.";
  const parts = [
    `${counts.requests} request${counts.requests === 1 ? "" : "s"} across ${counts.distinctPaths} page${counts.distinctPaths === 1 ? "" : "s"}.`,
  ];
  if (counts.movesToNewPage + counts.movesToSeenPage > 0) {
    parts.push(
      `${counts.movesToNewPage} move${counts.movesToNewPage === 1 ? "" : "s"} went to a page not requested before, ${counts.movesToSeenPage} returned to one already requested.`,
    );
  }
  if (counts.busiest.length > 0 && counts.busiest[0].visits > 1) {
    parts.push(
      `Most requested: ${counts.busiest
        .filter((entry) => entry.visits > 1)
        .map((entry) => `${entry.path} (${entry.visits})`)
        .join(", ")}.`,
    );
  }
  return parts.join(" ");
}

/**
 * Builds the walk, and decides whether it can be drawn legibly. Requests are
 * expected in time order, oldest first, as the timeline query returns them.
 */
export function buildPathGraph(requests: TimelineRequest[]): PathGraphResult {
  const { paths, moves, counts } = counted(requests);
  if (paths.length === 0) return { kind: "empty" };

  const description = describePathGraph(counts);

  if (
    counts.distinctPaths > MAX_GRAPH_NODES ||
    counts.transitions > MAX_GRAPH_EDGES
  ) {
    const reason =
      counts.distinctPaths > MAX_GRAPH_NODES
        ? `${counts.distinctPaths} distinct pages is past the ${MAX_GRAPH_NODES} this view can draw legibly`
        : `${counts.transitions} page-to-page moves is past the ${MAX_GRAPH_EDGES} this view can draw legibly`;
    return { kind: "too-large", counts, reason, description };
  }

  const graph = layout(paths);
  const position = new Map(graph.nodes.map((node) => [node.path, node]));
  graph.edges = Array.from(moves.entries()).flatMap(([from, out]) =>
    Array.from(out.entries()).map(([to, count]) => {
      const a = position.get(from)!;
      const b = position.get(to)!;
      // Bow the arc to one side of the straight line, consistently by direction,
      // so a move and its return are both visible instead of overlapping.
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const length = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const bow = Math.min(34, length / 4);
      return {
        from,
        to,
        count,
        x1: a.x,
        y1: a.y,
        x2: b.x,
        y2: b.y,
        cx: midX + (dy / length) * bow,
        cy: midY - (dx / length) * bow,
      };
    }),
  );

  return { kind: "graph", graph, counts, description };
}
