import type { WebBotAuthResult } from "@/lib/agent-traffic/web-bot-auth";

/**
 * Comparing what a site's edge concluded about a signature with what TrustTab
 * concluded about the same request.
 *
 * ## Why this doesn't pick a winner
 *
 * Until now the dashboard said "where they differ, TrustTab is right." That was
 * true while the edge didn't verify at all. It stops being true here, and would
 * become actively misleading, because the two are not checking the same thing:
 *
 *   - **The edge sees the real inbound request.**
 *   - **TrustTab sees a reconstruction** — `recordSiteHits` rebuilds a Request
 *     from the URL, method and the six headers the collector forwards.
 *
 * An RFC 9421 signature covers a specific list of components. If an agent signs
 * anything the collector doesn't forward — `date`, `content-digest`, a custom
 * header — then the signature is genuinely valid and TrustTab still cannot
 * verify it, because it no longer has the bytes that were signed. For signature
 * verification specifically, the edge is the better-positioned of the two.
 *
 * So a disagreement is reported as *which* disagreement it is. Most classes
 * here have a routine explanation and measure something about TrustTab's own
 * collector or caches; exactly one has no routine explanation and is worth a
 * person's attention.
 */

/** What either side concluded, in one vocabulary so they can be compared. */
export type Verdict = "valid" | "invalid" | "no-key" | "not-signed";

/**
 * Maps the server's richer result onto the shared vocabulary.
 *
 * `directory-unavailable` and `budget` both mean "couldn't get keys", which is
 * the same position the edge is in when the feed carried no key for an
 * identity — not a judgment about the signature.
 */
export function serverVerdict(result: WebBotAuthResult): Verdict {
  if (result.ok) return "valid";
  switch (result.reason) {
    case "not-signed":
    case "no-agent":
      return "not-signed";
    case "unverified":
      return "invalid";
    case "directory-unavailable":
    case "budget":
      return "no-key";
  }
}

export type DisagreementClass =
  | "agree"
  /** Edge verified; TrustTab couldn't rebuild the signed bytes. Expected, and about our collector. */
  | "unforwardable-component"
  /** Edge had a key TrustTab's 6-hour directory cache hadn't caught up to, or vice versa. */
  | "cache-skew"
  /** The feed hadn't carried a key the server could reach. */
  | "feed-missing-key"
  /** Edge rejected a signature TrustTab accepted. No routine explanation. */
  | "edge-rejected-server-accepted"
  /** Anything the classes above don't describe. */
  | "unclassified";

export type Comparison = {
  edge: Verdict;
  server: Verdict;
  class: DisagreementClass;
  title: string;
  detail: string;
  /**
   * Whether a person should look at this. Most disagreement classes are
   * routine consequences of how the two sides differ, and flagging them all
   * equally would bury the one that isn't.
   */
  concerning: boolean;
};

const AGREE: Omit<Comparison, "edge" | "server"> = {
  class: "agree",
  title: "Your edge and TrustTab reached the same conclusion",
  detail: "Both checked this request's signature and agreed on the result.",
  concerning: false,
};

export function compareVerdicts(edge: Verdict, server: Verdict): Comparison {
  if (edge === server) return { edge, server, ...AGREE };

  // The class this milestone exists to measure. Routine, and it says something
  // about what the collector forwards rather than about the agent or the edge.
  if (edge === "valid" && server === "invalid") {
    return {
      edge,
      server,
      class: "unforwardable-component",
      title: "Your edge verified a signature TrustTab could not",
      detail:
        "TrustTab rebuilds the request from the fields your collector forwards, so a signature covering a header that isn't forwarded will verify at your edge and fail here. This is the expected result for agents that sign a broader set of components than we forward — it measures what the collector carries, not the agent and not your edge.",
      concerning: false,
    };
  }

  if ((edge === "valid" && server === "no-key") || (edge === "no-key" && server === "valid")) {
    return {
      edge,
      server,
      class: "cache-skew",
      title: "One side had keys the other didn't yet",
      detail:
        "TrustTab caches an agent's published keys for six hours; your feed refreshes every few minutes. Around a key rotation the two are briefly out of step in whichever direction the timing falls. Routine, and it resolves itself.",
      concerning: false,
    };
  }

  if (edge === "no-key" && server === "invalid") {
    return {
      edge,
      server,
      class: "feed-missing-key",
      title: "Your edge had no key for this agent",
      detail:
        "The feed hadn't carried a key for the identity this request claimed, so your edge couldn't check the signature at all. That is not a judgment about the signature — it means the edge had nothing to check it against.",
      concerning: false,
    };
  }

  // The one with no routine explanation.
  if (edge === "invalid" && server === "valid") {
    return {
      edge,
      server,
      class: "edge-rejected-server-accepted",
      title: "Your edge rejected a signature TrustTab accepted",
      detail:
        "Unlike the other ways these two can differ, this one has no ordinary explanation: TrustTab verified against a reconstruction, so a signature it accepts should verify at the edge, which saw the real request. Worth looking at before this architecture is trusted to act on anything.",
      concerning: true,
    };
  }

  return {
    edge,
    server,
    class: "unclassified",
    title: "Your edge and TrustTab reached different conclusions",
    detail: `Your edge said ${edge}; TrustTab said ${server}. This combination doesn't match a known explanation, which is itself worth noting.`,
    concerning: true,
  };
}
