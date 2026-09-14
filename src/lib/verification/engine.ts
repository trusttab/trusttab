import "server-only";

import { getIssuer } from "@/lib/manifest/build";
import { getPublicJwks } from "@/lib/manifest/signing";
import type { Manifest } from "@/lib/manifest/types";
import type { SafeFetchResult } from "@/lib/safe-fetch";
import { fetchSitePage } from "@/lib/site-fetch";

import { matchForm } from "./form-match";
import { scanForInjection } from "./injection-scan";
import { evaluateServedManifest } from "./served-manifest";
import type { CheckDetail, CheckResult, VerificationResults } from "./types";

export const WELL_KNOWN_PATH = "/.well-known/agent-trust.json";
const FETCH_CONCURRENCY = 4;

export type VerificationOutcome = {
  results: VerificationResults;
  passed: boolean;
  /** True when the injection scan found manipulative content (not merely failed to scan). */
  injectionDetected: boolean;
};

/**
 * Runs every verification check against a site's live pages.
 *
 * Pages are fetched once each (homepage + every declared endpoint path) and
 * shared between checks. All fetches go through the SSRF-hardened fetcher and
 * only follow redirects within the site — except the well-known manifest,
 * which may also redirect to this issuer's public manifest URL for the site.
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

  const issuerManifestUrl = new URL(`${getIssuer().url}/api/manifest/${domain}`);
  const wellKnown = await fetchSitePage(domain, WELL_KNOWN_PATH, {
    alsoAllowRedirect: (url) => url.origin === issuerManifestUrl.origin && url.pathname === issuerManifestUrl.pathname,
  });

  const endpointCheck = checkEndpoints(manifest, pages);
  const { check: injectionCheck, detected } = checkInjection(pages);
  const sslCheck = checkSsl([...pages.values()].map((p) => p.result).concat(wellKnown.result));
  const [domainCheck, expiryCheck] = checkServedManifest(wellKnown.result, domain, verificationId);

  const checks = [endpointCheck, injectionCheck, sslCheck, domainCheck, expiryCheck];
  return {
    results: { checks },
    passed: checks.every((c) => c.passed),
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
    return { subject, passed: match.passed, message: match.message, note: match.note };
  });

  const failed = details.filter((d) => !d.passed).length;
  return {
    id: "endpoint_match",
    label: "Declared forms exist with the declared fields",
    passed: failed === 0,
    message: failed === 0 ? `All ${details.length} endpoints matched.` : `${failed} of ${details.length} endpoints did not match.`,
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

function checkServedManifest(result: SafeFetchResult, domain: string, verificationId: string): [CheckResult, CheckResult] {
  const domainBase = { id: "domain_match", label: "Manifest is served from its own domain" } as const;
  const expiryBase = { id: "expiry", label: "Served manifest has not expired" } as const;
  const url = `https://${domain}${WELL_KNOWN_PATH}`;

  let failure: string | null = null;
  if (!result.ok) failure = `Could not load ${url}: ${result.error}`;
  else if (result.status === 404) failure = `${url} returned 404. Add a redirect from that path to your TrustTab manifest URL.`;
  else if (result.status >= 400) failure = `${url} returned HTTP ${result.status}.`;

  if (failure !== null || !result.ok) {
    return [
      { ...domainBase, passed: false, message: failure!, details: [] },
      { ...expiryBase, passed: false, message: "Not evaluated: no manifest was served.", details: [] },
    ];
  }

  const verdict = evaluateServedManifest({ body: result.body, domain, verificationId, jwks: getPublicJwks() });
  return [
    { ...domainBase, ...verdict.domainMatch, details: [] },
    { ...expiryBase, ...verdict.expiry, details: [] },
  ];
}

async function mapWithConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(limit, queue.length) }, async () => {
      while (queue.length > 0) await fn(queue.shift()!);
    }),
  );
}
