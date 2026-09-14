import "server-only";

import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { BlockList, isIP } from "node:net";

import { Agent, fetch } from "undici";

/**
 * Fetching user-supplied URLs from our servers is a classic SSRF vector: a
 * "domain" could resolve to 127.0.0.1, a cloud metadata endpoint
 * (169.254.169.254) or a private network address. Everything in TrustTab that
 * fetches a site on a user's behalf must go through `safeFetchText`.
 *
 * Protection is enforced at *connection time*: the undici Agent below uses a
 * custom DNS lookup that refuses to hand non-public addresses to the socket.
 * Validating inside the lookup (rather than resolving once up front and then
 * fetching) means a DNS answer can't change between the check and the connect.
 */

const blocked = new BlockList();
// IPv4 — RFC 6890 special-purpose ranges.
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local, incl. cloud metadata
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved + broadcast
] as const) {
  blocked.addSubnet(net, prefix, "ipv4");
}
// IPv6. IPv4-mapped addresses (::ffff:a.b.c.d) are deliberately *not* listed:
// BlockList also matches plain IPv4 addresses against mapped rules, so a
// ::ffff:0:0/96 entry would block all of IPv4. isPublicAddress unwraps mapped
// addresses and checks them against the IPv4 list instead.
for (const [net, prefix] of [
  ["::", 128], // unspecified
  ["::1", 128], // loopback
  ["64:ff9b::", 96], // NAT64
  ["100::", 64], // discard
  ["2001:db8::", 32], // documentation
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link-local
  ["ff00::", 8], // multicast
] as const) {
  blocked.addSubnet(net, prefix, "ipv6");
}

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blocked.check(address, "ipv4");
  if (family === 6) {
    const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
    if (mapped) return !blocked.check(mapped[1], "ipv4");
    return !blocked.check(address, "ipv6");
  }
  return false;
}

class BlockedAddressError extends Error {
  code = "ERR_TRUSTTAB_BLOCKED_ADDRESS";
}

/** A dns.lookup drop-in that only ever yields public addresses. */
const publicOnlyLookup: typeof dnsLookup = ((
  hostname: string,
  options: { all?: boolean } & Record<string, unknown>,
  callback: (
    err: NodeJS.ErrnoException | null,
    address: string | LookupAddress[],
    family?: number,
  ) => void,
) => {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, options.all ? [] : "");
    const allowed = addresses.filter((a) => isPublicAddress(a.address));
    if (allowed.length === 0) {
      return callback(
        new BlockedAddressError(`${hostname} does not resolve to a public address`),
        options.all ? [] : "",
      );
    }
    if (options.all) return callback(null, allowed);
    callback(null, allowed[0].address, allowed[0].family);
  });
}) as typeof dnsLookup;

const agent = new Agent({
  connect: { lookup: publicOnlyLookup, timeout: 5_000 },
  headersTimeout: 8_000,
  bodyTimeout: 8_000,
});

export type SafeFetchResult =
  | { ok: true; status: number; finalUrl: string; body: string }
  | { ok: false; error: string };

export type SafeFetchOptions = {
  /** Called for every redirect target; return false to refuse following it. */
  allowRedirect: (target: URL) => boolean;
  maxRedirects?: number;
  maxBytes?: number;
  timeoutMs?: number;
};

const USER_AGENT = "TrustTabBot/0.1 (site ownership and agent-trust verification)";

/**
 * GETs an HTTPS URL and returns its body as text, with:
 * - HTTPS only (a successful fetch doubles as the SSL-validity check)
 * - public-address-only connections (see above)
 * - manual, allow-listed redirects
 * - a response size cap and an overall timeout
 */
export async function safeFetchText(
  url: string,
  { allowRedirect, maxRedirects = 5, maxBytes = 1_000_000, timeoutMs = 10_000 }: SafeFetchOptions,
): Promise<SafeFetchResult> {
  let current = new URL(url);
  const signal = AbortSignal.timeout(timeoutMs);

  try {
    for (let hop = 0; hop <= maxRedirects; hop++) {
      if (current.protocol !== "https:") {
        return { ok: false, error: `Refusing to fetch non-HTTPS URL ${current.href}` };
      }
      if (isIP(current.hostname.replace(/^\[|\]$/g, ""))) {
        return { ok: false, error: "Refusing to fetch an IP address directly" };
      }

      const res = await fetch(current, {
        dispatcher: agent,
        redirect: "manual",
        signal,
        headers: { "user-agent": USER_AGENT, accept: "text/html,*/*;q=0.5" },
      });

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        await res.body?.cancel();
        if (!location) return { ok: false, error: `Redirect (${res.status}) without a Location header` };
        const next = new URL(location, current);
        if (!allowRedirect(next)) {
          return { ok: false, error: `Redirected to ${next.origin}, which is a different site` };
        }
        current = next;
        continue;
      }

      const body = await readCapped(res.body, maxBytes);
      return { ok: true, status: res.status, finalUrl: current.href, body };
    }
    return { ok: false, error: "Too many redirects" };
  } catch (err) {
    return { ok: false, error: describeFetchError(err, current) };
  }
}

async function readCapped(
  stream: AsyncIterable<Uint8Array> | null,
  maxBytes: number,
): Promise<string> {
  if (!stream) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const remaining = maxBytes - total;
    chunks.push(chunk.byteLength > remaining ? chunk.subarray(0, remaining) : chunk);
    total += Math.min(chunk.byteLength, remaining);
    // The verification tag belongs in <head>, so a truncated body is fine.
    // Breaking out of the loop cancels the underlying stream.
    if (total >= maxBytes) break;
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/** Turns low-level network errors into messages a site owner can act on. */
function describeFetchError(err: unknown, url: URL): string {
  const e = err as { name?: string; code?: string; cause?: { code?: string; message?: string } };
  const code = e?.cause?.code ?? e?.code;
  if (e?.name === "TimeoutError" || e?.name === "AbortError") return `Timed out fetching ${url.origin}`;
  if (code === "ERR_TRUSTTAB_BLOCKED_ADDRESS") return `${url.hostname} does not resolve to a public IP address`;
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return `Could not resolve ${url.hostname} (DNS lookup failed)`;
  if (code === "ECONNREFUSED") return `Connection to ${url.origin} was refused`;
  if (typeof code === "string" && /CERT|SSL|TLS/.test(code)) {
    return `HTTPS certificate problem on ${url.hostname} (${code})`;
  }
  return `Could not fetch ${url.origin}${code ? ` (${code})` : ""}`;
}
