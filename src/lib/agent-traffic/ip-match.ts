/**
 * CIDR matching for the published agent IP ranges in ranges.json. Pure and
 * dependency-free, so it is unit tested directly.
 */

import rangesFile from "./ranges.json";

export type OperatorRanges = { operator: string; product: string; url: string; prefixes: string[] };

export const AGENT_RANGES: OperatorRanges[] = rangesFile.operators;
/** The day ranges.json was last refreshed (scripts/update-agent-ranges.mjs). */
export const RANGES_RETRIEVED: string = rangesFile.retrieved;

/**
 * An IP as its numeric parts (4 octets, or 8 16-bit groups) plus its family,
 * or null if it isn't an address. Parts rather than one big number, because
 * the project's TypeScript target predates BigInt literals.
 */
export function parseIp(value: string): { parts: number[]; bitsPerPart: 8 | 16 } | null {
  const address = value.trim().replace(/^\[|\]$/g, "");
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address);
  const candidate = mapped ? mapped[1] : address;

  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(candidate)) {
    const parts = candidate.split(".").map(Number);
    if (parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return null;
    return { parts, bitsPerPart: 8 };
  }
  if (!address.includes(":")) return null;

  const [head, tail] = address.split("::");
  const headGroups = head ? head.split(":") : [];
  const tailGroups = address.includes("::") ? (tail ? tail.split(":") : []) : [];
  const groups = address.includes("::")
    ? [...headGroups, ...Array<string>(8 - headGroups.length - tailGroups.length).fill("0"), ...tailGroups]
    : headGroups;
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{0,4}$/i.test(g))) return null;
  return { parts: groups.map((g) => parseInt(g || "0", 16)), bitsPerPart: 16 };
}

export function ipInCidr(ip: string, cidr: string): boolean {
  const [network, lengthText] = cidr.split("/");
  const prefixLength = Number(lengthText);
  const target = parseIp(ip);
  const base = parseIp(network);
  if (!target || !base || !Number.isInteger(prefixLength)) return false;
  if (target.bitsPerPart !== base.bitsPerPart) return false;
  const size = target.parts.length * target.bitsPerPart;
  if (prefixLength < 0 || prefixLength > size) return false;

  let remaining = prefixLength;
  for (let i = 0; i < target.parts.length && remaining > 0; i++) {
    const bits = Math.min(remaining, target.bitsPerPart);
    const shift = target.bitsPerPart - bits;
    if (target.parts[i] >> shift !== base.parts[i] >> shift) return false;
    remaining -= bits;
  }
  return true;
}

/** The first published range containing `ip`, or null. */
export function matchAgentRange(ip: string, ranges: OperatorRanges[] = AGENT_RANGES): OperatorRanges | null {
  if (!parseIp(ip)) return null;
  return ranges.find((entry) => entry.prefixes.some((prefix) => ipInCidr(ip, prefix))) ?? null;
}
