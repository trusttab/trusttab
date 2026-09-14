import "server-only";

import { getIssuer } from "@/lib/manifest/build";
import { getPublicJwks } from "@/lib/manifest/signing";
import type { Manifest } from "@/lib/manifest/types";
import { safeFetchText, type SafeFetchResult } from "@/lib/safe-fetch";
import { fetchSitePage, isSameSite } from "@/lib/site-fetch";

import { matchForm } from "./form-match";
import { scanForInjection } from "./injection-scan";
import { findManifestLink, MANIFEST_LINK_REL } from "./manifest-link";
import { summarizeOutcome, type OutcomeSummary } from "./outcome";
import { evaluateServedManifest } from "./served-manifest";
import type { CheckDetail, CheckResult, VerificationResults } from "./types";

export const WELL_KNOWN_PATH = "/.well-known/agent-trust.json";
const FETCH_CONCURRENCY = 4;

export type VerificationOutcome = {
  results: VerificationResults;
  /** True only when every automated check passed. */
  passed: boolean;
  summary: OutcomeSummary;
  /** True when the injection scan found manipulative content (not merely failed to scan). */
  injectionDetected: boolean;
};

/**
 * Runs every verification check against a site's live pages.
 *
 * Pages are fetched once each (homepage + every declared endpoint path) and
 * shared between checks. All fetches go through the SSRF-hardened fetcher and
 * only follow redirects within the site — except manifest discovery, which
 * may also reach this issuer's public manifest URL for the site.
 */
export async function runVerification(args: {
  domain: string;
  verificationId: string;
  manifest: Manifest;
}): Promise<VerificationOutcome> {
  const { domain, verificationId, manifest } = args;

  const paths = [...new Set(["/", ...manifest.endpoints.map((e) => e.path)])];
  const pages = new Map<string, { url: string; result: SafeFetchResult }>();
  await mapWithConcurrency(paths, FETCH_CONCURRENCY, async (path) => {
    const { requestedUrl, result } = await fetchSitePage(domain, path);
    pages.set(path, { url: result.ok ? result.finalUrl : requestedUrl, result });
  });

  const discovery = await discoverServedManifest(domain, verificationId, pages.get("/")!);

  const endpointCheck = checkEndpoints(manifest, pages);
  const { check: injectionCheck, detected } = checkInjection(pages);
  const sslCheck = checkSsl([...pages.values()].map((p) => p.result).concat(discovery.fetches));
  const [domainCheck, expiryCheck] = discovery.checks;

  const checks = [endpointCheck, injectionCheck, sslCheck, domainCheck, expiryCheck];
  return {
    results: { checks },
    passed: checks.every((c) => c.passed),
    summary: summarizeOutcome(checks),
    injectionDetected: detected,
  };
}

function checkEndpoints(manifest: Manifest, pages: Map<string, { url: string; result: SafeFetchResult }>): CheckResult {
  const details: CheckDetail[] = manifest.endpoints.map((endpoint) => {
    const subject = `${endpoint.method} ${endpoint.path}`;
    const { url, result } = pages.get(endpoint.path)!;
    if (!result.ok) return { subject, passed: false, message: `Could not load ${url}: ${result.error}` };
    if (result.status >= 400) return { subject, passed: false, message: `${url} returned HTTP ${result.status}.` };

    const match = matchForm(result.body, Object.keys(endpoint.schema), endpoint.method);
    if (match.passed || !endpoint.self_attested) {
      return { subject, passed: match.passed, message: match.message, note: match.note };
    }
    // Self-attestation covers only a form the scanner couldn't see on a page
    // that loaded fine (typically rendered by JavaScript). It never covers a
    // missing page, which is handled above.
    return {
      subject,
      passed: false,
      selfDeclared: true,
      message: `Not confirmed automatically: ${match.message} The owner self-attests that this form exists as declared.`,
    };
  });

  const failed = details.filter((d) => !d.passed && !d.selfDeclared).length;
  const selfDeclared = details.filter((d) => d.selfDeclared).length;
  const confirmed = details.length - failed - selfDeclared;
  return {
    id: "endpoint_match",
    label: "Declared forms exist with the declared fields",
    passed: failed === 0 && selfDeclared === 0,
    message:
      `${confirmed} of ${details.length} endpoint(s) confirmed automatically` +
      (selfDeclared ? `, ${selfDeclared} self-declared by the owner (not confirmed)` : "") +
      (failed ? `, ${failed} did not match.` : "."),
    details,
  };
}

function checkInjection(pages: Map<string, { url: string; result: SafeFetchResult }>) {
  let detected = false;
  const details: CheckDetail[] = [...pages.values()].map(({ url, result }) => {
    if (!result.ok) return { subject: url, passed: false, message: `Could not be scanned: ${result.error}` };
    const findings = scanForInjection(result.body);
    if (findings.length === 0) return { subject: url, passed: true, message: "No prompt-injection content found." };
    detected = true;
    return {
      subject: url,
      passed: false,
      message: findings.map((f) => `${f.description}: "${f.excerpt}"`).join("\n"),
    };
  });

  const check: CheckResult = {
    id: "injection_scan",
    label: "No hidden prompt-injection content",
    passed: details.every((d) => d.passed),
    message: detected
      ? "Content that could manipulate AI agents was found."
      : details.every((d) => d.passed)
        ? `Scanned ${details.length} page(s); nothing found.`
        : "Some pages could not be scanned.",
    details,
  };
  return { check, detected };
}

function checkSsl(results: SafeFetchResult[]): CheckResult {
  const certErrors = results.flatMap((r) => (!r.ok && /certificate/i.test(r.error) ? [r.error] : []));
  const anyHttpsSuccess = results.some((r) => r.ok);
  const passed = certErrors.length === 0 && anyHttpsSuccess;
  return {
    id: "ssl",
    label: "Valid HTTPS",
    passed,
    message: passed
      ? "Pages were fetched over HTTPS with valid certificates."
      : certErrors.length > 0
        ? "HTTPS certificate problems were found."
        : "Could not connect to the site over HTTPS.",
    details: [...new Set(certErrors)].map((message) => ({ subject: "certificate", passed: false, message })),
  };
}

/**
 * Checks 4–5: find the manifest the site serves, then evaluate it.
 *
 * Discovery order:
 * 1. https://<domain>/.well-known/agent-trust.json. If this returns a
 *    manifest-shaped JSON document, it is authoritative — pass or fail, no fallback — because
 *    that's the document agents reading the well-known path will get.
 * 2. Otherwise (404, error, or anything that isn't a manifest, such as a site
 *    builder's reserved-path error or an SPA's HTML shell), a
 *    `<link rel>` or `<meta name>` "agent-trust-manifest" pointer in the
 *    homepage <head>, for platforms that reserve /.well-known/.
 *
 * Both routes may only reach URLs on the site itself or exactly this
 * issuer's manifest URL for the domain.
 */
async function discoverServedManifest(
  domain: string,
  verificationId: string,
  homepage: { url: string; result: SafeFetchResult },
): Promise<{ checks: [CheckResult, CheckResult]; fetches: SafeFetchResult[] }> {
  const issuerManifestUrl = new URL(`${getIssuer().url}/api/manifest/${domain}`);
  const isIssuerManifestUrl = (url: URL) =>
    url.origin === issuerManifestUrl.origin && url.pathname === issuerManifestUrl.pathname;
  const allowed = (url: URL) => isSameSite(url, domain) || isIssuerManifestUrl(url);

  const fail = (message: string): [CheckResult, CheckResult] => [
    { ...DOMAIN_CHECK, passed: false, message, details: [] },
    { ...EXPIRY_CHECK, passed: false, message: "Not evaluated: no manifest was found.", details: [] },
  ];
  const evaluate = (body: string, via: string): [CheckResult, CheckResult] => {
    const verdict = evaluateServedManifest({ body, domain, verificationId, jwks: getPublicJwks() });
    return [
      { ...DOMAIN_CHECK, ...verdict.domainMatch, message: `${verdict.domainMatch.message} (found via ${via})`, details: [] },
      { ...EXPIRY_CHECK, ...verdict.expiry, details: [] },
    ];
  };

  // 1. Well-known path.
  const wellKnownUrl = `https://${domain}${WELL_KNOWN_PATH}`;
  const wellKnown = await fetchSitePage(domain, WELL_KNOWN_PATH, { alsoAllowRedirect: isIssuerManifestUrl });
  const fetches = [wellKnown.result];
  if (wellKnown.result.ok && wellKnown.result.status < 300 && looksLikeManifest(wellKnown.result.body)) {
    return { checks: evaluate(wellKnown.result.body, WELL_KNOWN_PATH), fetches };
  }
  const wellKnownProblem = !wellKnown.result.ok
    ? wellKnown.result.error
    : wellKnown.result.status >= 300
      ? `HTTP ${wellKnown.result.status}`
      : "did not return a manifest";

  // 2. <link rel="agent-trust-manifest"> on the homepage.
  const href = homepage.result.ok ? findManifestLink(homepage.result.body, homepage.result.finalUrl) : null;
  if (!href) {
    return {
      checks: fail(
        `No manifest found. ${wellKnownUrl}: ${wellKnownProblem}. The homepage <head> also has no <link rel="${MANIFEST_LINK_REL}"> or <meta name="${MANIFEST_LINK_REL}"> tag. ` +
          `Add one of them, pointing at ${issuerManifestUrl.href}.`,
      ),
      fetches,
    };
  }

  const linkUrl = new URL(href);
  if (linkUrl.protocol !== "https:" || !allowed(linkUrl)) {
    return {
      checks: fail(`The homepage's ${MANIFEST_LINK_REL} tag points to ${href}; it must point to ${issuerManifestUrl.href} or a URL on ${domain}.`),
      fetches,
    };
  }
  const linked = await safeFetchText(href, { allowRedirect: allowed });
  fetches.push(linked);
  if (!linked.ok) return { checks: fail(`Could not load the linked manifest ${href}: ${linked.error}`), fetches };
  if (linked.status >= 300) return { checks: fail(`The linked manifest ${href} returned HTTP ${linked.status}.`), fetches };
  return { checks: evaluate(linked.body, `the homepage ${MANIFEST_LINK_REL} tag`), fetches };
}

const DOMAIN_CHECK = { id: "domain_match", label: "Manifest is served for its own domain" } as const;
const EXPIRY_CHECK = { id: "expiry", label: "Served manifest has not expired" } as const;

/** True if the body parses as a JSON object shaped like a manifest (not, say, a JSON error page). */
export function looksLikeManifest(body: string): boolean {
  try {
    const parsed = JSON.parse(body);
    return typeof parsed === "object" && parsed !== null && "site" in parsed && "issuer" in parsed;
  } catch {
    return false;
  }
}

async function mapWithConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(limit, queue.length) }, async () => {
      while (queue.length > 0) await fn(queue.shift()!);
    }),
  );
}
