import { isIP } from "node:net";

export type DomainResult =
  | { ok: true; domain: string }
  | { ok: false; error: string };

/**
 * Hostname suffixes that can never be a publicly reachable site. These are
 * rejected up front with a friendly message; the safe fetcher separately
 * blocks any hostname that *resolves* to a private address.
 */
const RESERVED_SUFFIXES = [
  "localhost",
  "local",
  "internal",
  "intranet",
  "lan",
  "home",
  "corp",
  "test",
  "example",
  "invalid",
  "onion",
];

/**
 * Turns whatever a user typed ("https://www.Example.com/contact", "example.com.")
 * into the canonical hostname we store and verify against ("example.com").
 *
 * Canonicalization rules:
 * - scheme, path, query, port and trailing dot are dropped
 * - lowercased; internationalized names are converted to punycode
 * - a leading `www.` is stripped, so `www.example.com` and `example.com` are
 *   the same claim. Other subdomains (`app.example.com`) are distinct claims.
 */
export function normalizeDomain(input: string): DomainResult {
  const raw = input.trim();
  if (!raw) return { ok: false, error: "Enter a domain." };
  if (raw.length > 300) return { ok: false, error: "That domain is too long." };

  let hostname: string;
  try {
    // Prefixing a scheme lets the WHATWG URL parser do the heavy lifting
    // (IDN → punycode, lowercasing, stripping paths and ports).
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return { ok: false, error: "Enter a website domain, like example.com." };
    }
    if (url.username || url.password) {
      return { ok: false, error: "Enter just the domain, like example.com." };
    }
    hostname = url.hostname;
  } catch {
    return { ok: false, error: "That doesn't look like a valid domain." };
  }

  hostname = hostname.replace(/\.$/, "");
  if (hostname.startsWith("www.")) hostname = hostname.slice(4);

  if (isIP(hostname) || hostname.startsWith("[")) {
    return { ok: false, error: "Enter a domain name, not an IP address." };
  }

  const labels = hostname.split(".");
  const labelPattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
  if (
    labels.length < 2 ||
    hostname.length > 253 ||
    !labels.every((label) => labelPattern.test(label)) ||
    // The TLD is never all-numeric.
    /^\d+$/.test(labels[labels.length - 1])
  ) {
    return { ok: false, error: "That doesn't look like a valid domain." };
  }

  if (RESERVED_SUFFIXES.includes(labels[labels.length - 1])) {
    return { ok: false, error: "That domain isn't publicly reachable." };
  }

  return { ok: true, domain: hostname };
}
