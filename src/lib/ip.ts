import { isIP } from "node:net";

/**
 * Client IP handling for public endpoints.
 *
 * The IP comes from `x-forwarded-for`, which is trustworthy only behind a
 * proxy that overwrites it (Vercel does). Self-hosters must run behind such a
 * proxy, or clients can claim any IP — which weakens rate limiting and makes
 * the traffic log unreliable.
 */
export function clientIp(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const candidate = forwarded || request.headers.get("x-real-ip")?.trim() || "";
  return isIP(candidate) ? candidate : null;
}

/**
 * Coarsens an IP before it is stored: IPv4 to its /24 (last octet zeroed),
 * IPv6 to its /48. Enough to tell traffic sources apart in a log, without
 * keeping a personal identifier. IPv4-mapped IPv6 is treated as IPv4.
 */
export function anonymizeIp(ip: string): string | null {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) ip = mapped[1];

  const family = isIP(ip);
  if (family === 4) return ip.replace(/\.\d+$/, ".0");
  if (family !== 6) return null;

  const [head, tail = ""] = ip.toLowerCase().split("::");
  const headGroups = head ? head.split(":") : [];
  const tailGroups = ip.includes("::") && tail ? tail.split(":") : [];
  const groups = ip.includes("::")
    ? [...headGroups, ...Array(8 - headGroups.length - tailGroups.length).fill("0"), ...tailGroups]
    : headGroups;
  return `${groups.slice(0, 3).map((g) => g.replace(/^0+(?=.)/, "")).join(":")}::`;
}
