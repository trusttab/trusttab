import { ipInCidr, parseIp } from "./ip-match";

/**
 * Agents a site owner registers as their own.
 *
 * This is deliberately *not* held to the standard declared intent is held to.
 * An external agent claiming an identity to a site it doesn't control is an
 * adversarial claim, which is why that path requires a signature. An owner
 * tagging their own known traffic, on their own dashboard, has nobody to
 * deceive and nothing to gain by mislabelling it. So the bar here is honesty
 * about what the label is — a self-configured guess at matching a signal —
 * rather than proof.
 *
 * The signals are all forgeable by a third party, and the UI says so: a
 * user-agent string can be copied, and an IP can be shared by a whole office.
 * That is acceptable for "label my own traffic" and would not be acceptable
 * for anything making a claim to someone else.
 */

/** The header a collector always forwards, so an owner can tag an agent they can configure. */
export const OWNER_AGENT_HEADER = "x-trusttab-agent";

export type OwnerAgentMatchType = "user_agent" | "ip" | "header";

export type OwnerAgent = {
  id: string;
  name: string;
  matchType: OwnerAgentMatchType;
  matchValue: string;
};

export type OwnerAgentSignals = {
  userAgent: string | null;
  ip: string | null;
  /** The value of the x-trusttab-agent header, when the agent sent one. */
  headerValue: string | null;
};

export const MAX_OWNER_AGENTS_PER_SITE = 20;
const MAX_NAME_CHARS = 60;
const MAX_VALUE_CHARS = 200;

/** Validates one registration. Returns the cleaned values, or why they were rejected. */
export function validateOwnerAgent(input: {
  name?: unknown;
  matchType?: unknown;
  matchValue?: unknown;
}): { ok: true; value: Omit<OwnerAgent, "id"> } | { ok: false; error: string } {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const matchValue = typeof input.matchValue === "string" ? input.matchValue.trim() : "";
  const matchType = input.matchType;

  if (!name || name.length > MAX_NAME_CHARS) return { ok: false, error: `Give it a name of 1 to ${MAX_NAME_CHARS} characters.` };
  if (matchType !== "user_agent" && matchType !== "ip" && matchType !== "header") {
    return { ok: false, error: "Choose how to recognise it: user agent, IP address, or header." };
  }
  if (!matchValue || matchValue.length > MAX_VALUE_CHARS) return { ok: false, error: `Give a value of 1 to ${MAX_VALUE_CHARS} characters.` };

  if (matchType === "user_agent" && matchValue.length < 4) {
    // A 3-character fragment would match most browsers; that mislabels ordinary visitors.
    return { ok: false, error: "Use at least 4 characters of the user agent, so it doesn't match ordinary visitors." };
  }
  if (matchType === "ip") {
    const [address] = matchValue.split("/");
    if (!parseIp(address)) return { ok: false, error: "That isn't an IP address or range (for example 203.0.113.4 or 203.0.113.0/24)." };
  }
  return { ok: true, value: { name, matchType, matchValue } };
}

/** The first registered agent whose signal matches, or null. */
export function matchOwnerAgent(signals: OwnerAgentSignals, agents: OwnerAgent[]): OwnerAgent | null {
  for (const agent of agents) {
    if (agent.matchType === "user_agent") {
      if (signals.userAgent && signals.userAgent.toLowerCase().includes(agent.matchValue.toLowerCase())) return agent;
    } else if (agent.matchType === "header") {
      if (signals.headerValue && signals.headerValue.trim().toLowerCase() === agent.matchValue.toLowerCase()) return agent;
    } else if (signals.ip) {
      const value = agent.matchValue.includes("/") ? agent.matchValue : `${agent.matchValue}/${parseIp(agent.matchValue)?.bitsPerPart === 8 ? 32 : 128}`;
      if (ipInCidr(signals.ip, value)) return agent;
    }
  }
  return null;
}

/** How a match reads in the dashboard. */
export function describeOwnerAgent(agent: OwnerAgent): { identity: string; signal: string } {
  const how =
    agent.matchType === "user_agent"
      ? `you registered the user agent “${agent.matchValue}”`
      : agent.matchType === "ip"
        ? `you registered the address ${agent.matchValue}`
        : `you registered the ${OWNER_AGENT_HEADER} value “${agent.matchValue}”`;
  return { identity: `Your agent: ${agent.name}`, signal: `${how} as your own agent` };
}

/** Stated wherever owner-identified traffic appears, so the label is never mistaken for verification. */
export const OWNER_AGENT_LIMIT =
  "You told TrustTab this is your agent, so it's a label you set, not something TrustTab verified. It's only as good as the signal it matches: a user agent can be copied by anyone, and an IP address can be shared by everyone in an office or on a network.";
