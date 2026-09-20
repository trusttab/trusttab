/**
 * Copy for the two audience pages, and the scope limits they must carry.
 *
 * Both pages describe real, shipped behaviour, and both are one careless
 * sentence away from claiming something this product doesn't do — so the
 * limits live in data and `audiences.test.ts` pins them:
 *
 * - /for-agents must never read as though TrustTab issues identity. It checks
 *   signatures against keys the operator publishes; it is not an authority and
 *   mints nothing.
 * - /for-security must never read as agent governance. It covers agents
 *   arriving from outside at a public site or API — not an organisation's own
 *   deployed agents, which is a different category with its own tools.
 * - Neither may imply enforcement, certification, or audit-grade evidence.
 *   Enforcement is the unbuilt fifth stage; two of three classification tiers
 *   are explicitly estimates; site declarations are self-attested.
 */

export type ScopeLimit = {
  /** The heading a reader scans for. */
  claim: string;
  body: string;
};

export type Citation = {
  figure: string;
  finding: string;
  source: string;
  url: string;
  /**
   * Stated on the page when the research was paid for by a vendor in the
   * space. A commissioned survey can be sound and still isn't neutral, and
   * the reader is entitled to weigh it themselves.
   */
  disclosure?: string;
};

/**
 * Both studies measure something broader than this product covers: mostly
 * agents an organisation deploys itself. They are cited to establish that
 * agents exceeding their intended scope is common and real — not to imply
 * TrustTab addresses the internal-fleet part of it. The page says so in
 * `CITATION_SCOPE_NOTE`, which the test requires alongside them.
 */
export const CITATIONS: Citation[] = [
  {
    figure: "53%",
    finding: "of organizations have had AI agents exceed their intended permissions.",
    source: "Cloud Security Alliance, State of AI and Security Survey, April 2026 (445 IT and security professionals)",
    url: "https://cloudsecurityalliance.org/",
    disclosure: "Conducted by the CSA and commissioned by Zenity, an AI security vendor — sound work, but not neutral research.",
  },
  {
    figure: "13%",
    finding: "of organizations think they have the right AI agent governance in place.",
    source: "Gartner, “Gartner Identifies Six Steps to Manage AI Agent Sprawl”, April 2026",
    url: "https://www.gartner.com/en/newsroom/press-releases/2026-04-28-gartner-identifies-six-steps-to-manage-artificial-intelligence-agent-sprawl",
  },
];

export const CITATION_SCOPE_NOTE =
  "Both studies measure a broader problem than this page covers — largely agents organisations deploy themselves. They establish that agents exceeding their intended scope is common. They are not a claim that TrustTab solves that; TrustTab covers one slice of it, described below.";

/** The "what this is and isn't" block, stated above any feature on /for-security. */
export const SECURITY_SCOPE: ScopeLimit[] = [
  {
    claim: "This is inbound visibility.",
    body: "Agents from outside, arriving at your public-facing site or API: who they are, what they requested, in what order, and whether it matched what they declared.",
  },
  {
    claim: "This is not agent governance.",
    body: "It does not see, inventory, or control the agents your own company deploys — their credentials, permissions, or lifecycle. That is a different category with established tools in it (Astrix, Entro, Oasis); TrustTab does not do it and isn't trying to.",
  },
  {
    claim: "It observes; it does not enforce.",
    body: "Nothing here blocks, throttles, or refuses a request. Acting on what these signals show is the unbuilt fifth stage of our roadmap. Today this tells you what happened; your own infrastructure decides what to do about it.",
  },
  {
    claim: "It isn't audit evidence.",
    body: "Two of the three classification tiers are explicitly estimates, and a site's own declarations are self-attested. This is operational visibility, not a control you can point a compliance framework at.",
  },
];

/** Closing limits on /for-security: the things a reader would otherwise assume. */
export const SECURITY_LIMITS =
  "This only works on agents that participate at all. An actor who ignores Web Bot Auth entirely falls through to the estimate tier, exactly like any other unsigned client — this raises the floor for good-faith operators, it isn't a universal detector. Requests to your TrustTab manifest and registry entry are covered with nothing installed; seeing agents on your own pages needs a collector that's currently in limited release. And logging visitor traffic carries its own obligations under GDPR and similar — check your own privacy notice before enabling it.";

/** The closing disclaimer on /for-agents. */
export const AGENT_DISCLAIMER =
  "TrustTab does not issue identity credentials and is not an identity authority. It doesn't mint, sign, or vouch for your agent — you publish your own keys, and TrustTab checks signatures against them, the same way anyone else could. Being listed or verified says the signature checked out. It says nothing about how your agent behaves.";

/** How a site running TrustTab actually reports an agent, worst to best. */
export const AGENT_TIER_EXAMPLES: { agent: string; shown: string; strength: "estimate" | "none" | "fact" }[] = [
  { agent: "Unsigned, unrecognised", shown: "Unclassified — which means nothing more than that", strength: "none" },
  { agent: "Unsigned, on the known-agent list", shown: "YourBot (estimate) — a user agent match, which is a guess, not proof", strength: "estimate" },
  { agent: "Signed, and it verifies", shown: "https://youragent.example (verified) — checked against the keys you publish", strength: "fact" },
];
