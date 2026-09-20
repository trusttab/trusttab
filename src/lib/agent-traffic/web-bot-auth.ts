import "server-only";

import {
  HTTP_MESSAGE_SIGNATURES_DIRECTORY,
  parseSignatureAgentHeader,
  verify,
  type UntrustedWebBotSignatureCandidate,
  type WebBotVerifier,
} from "web-bot-auth";

import { safeFetchText } from "@/lib/safe-fetch";

import { INTENT_HEADER, parseIntentDeclaration, type IntentDeclaration } from "./intent";

/**
 * Tier 1: cryptographic verification of an inbound request (Web Bot Auth,
 * RFC 9421 HTTP Message Signatures).
 *
 * Verification itself comes from Cloudflare's `web-bot-auth` package, the
 * reference implementation of the protocol, rather than a hand-rolled RFC 9421
 * verifier. This module adds what a server needs around it: discovering the
 * agent's key directory safely, caching it, and refusing to be used as an
 * amplifier.
 *
 * What a success means: the request was signed by a key published at the
 * domain in its `Signature-Agent` header, and the signature covers this
 * request's target, so it can't be replayed against another site. What a
 * failure means: nothing about the visitor. Most agent traffic today is
 * unsigned (see display.ts).
 */

export type WebBotAuthResult =
  | {
      ok: true;
      identity: string;
      keyid: string;
      expires: Date;
      /**
       * The agent's declared intent, but only when the signature actually
       * covered the header. A declaration that wasn't signed is dropped: any
       * intermediary can append a header to someone else's signed request.
       */
      declaration: IntentDeclaration | null;
      /**
       * The components the signature actually covered, lowercased. Only these
       * are tamper-evident, which is why the diagnostic endpoint reports them:
       * an operator checking their own setup needs to see what they signed,
       * not just that something verified.
       */
      components: string[];
    }
  | { ok: false; reason: "not-signed" | "no-agent" | "unverified" | "directory-unavailable" | "budget" };

const DIRECTORY_TTL_MS = 6 * 60 * 60 * 1000;
const FAILURE_TTL_MS = 15 * 60 * 1000;
const MAX_CACHE_ENTRIES = 200;
const MAX_DIRECTORY_BYTES = 64_000;

/**
 * A cap on directory fetches per instance, because the `Signature-Agent`
 * header is attacker-controlled: without it, requests naming many different
 * hosts would make TrustTab fetch each one.
 */
const FETCH_BUDGET = { max: 60, windowMs: 10 * 60 * 1000, used: 0, windowStart: 0 };

/** A key from a published directory; `kid` is how a signature names it. */
export type DirectoryKey = JsonWebKey & { kid?: string };

type CacheEntry = { keys: DirectoryKey[] | null; expiresAt: number };
const directoryCache = new Map<string, CacheEntry>();

function withinBudget(now: number): boolean {
  if (now - FETCH_BUDGET.windowStart > FETCH_BUDGET.windowMs) {
    FETCH_BUDGET.windowStart = now;
    FETCH_BUDGET.used = 0;
  }
  if (FETCH_BUDGET.used >= FETCH_BUDGET.max) return false;
  FETCH_BUDGET.used += 1;
  return true;
}

/** Fetches (and caches) an agent's published keys. Uses the SSRF-safe fetcher: the URL comes from the request. */
async function directoryKeys(origin: string): Promise<DirectoryKey[] | null | "budget"> {
  const now = Date.now();
  const cached = directoryCache.get(origin);
  if (cached && cached.expiresAt > now) return cached.keys;
  if (!withinBudget(now)) return "budget";

  const url = new URL(HTTP_MESSAGE_SIGNATURES_DIRECTORY, origin);
  const result = await safeFetchText(url.href, {
    allowRedirect: (target) => target.origin === url.origin,
    maxBytes: MAX_DIRECTORY_BYTES,
    timeoutMs: 5_000,
  });

  let keys: DirectoryKey[] | null = null;
  if (result.ok && result.status === 200) {
    try {
      const parsed: unknown = JSON.parse(result.body);
      const list = (parsed as { keys?: unknown })?.keys;
      if (Array.isArray(list)) keys = list as DirectoryKey[];
    } catch {
      keys = null;
    }
  }

  if (directoryCache.size >= MAX_CACHE_ENTRIES) directoryCache.clear();
  directoryCache.set(origin, { keys, expiresAt: now + (keys ? DIRECTORY_TTL_MS : FAILURE_TTL_MS) });
  return keys;
}

async function verifierFor(candidate: UntrustedWebBotSignatureCandidate, keys: DirectoryKey[]): Promise<WebBotVerifier> {
  // Only Ed25519 today: it is what the published directories use (OpenAI, Google).
  if (candidate.algorithm !== "ed25519") throw new Error(`unsupported algorithm ${candidate.algorithm}`);
  const jwk = keys.find((key) => key.kid === candidate.keyid);
  if (!jwk) throw new Error("no published key with this key id");
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "Ed25519" }, false, ["verify"]);
  return {
    algorithm: "ed25519",
    keyid: candidate.keyid,
    // Copy into fresh views: WebCrypto's types require ArrayBuffer-backed buffers.
    verify: (data: Uint8Array, signature: Uint8Array) =>
      crypto.subtle.verify({ name: "Ed25519" }, key, new Uint8Array(signature).slice(), new Uint8Array(data).slice()),
  };
}

/**
 * Verifies an inbound request's signature, if it has one. Never throws: a
 * request that can't be verified is simply not verified.
 */
export type VerifyOptions = {
  /**
   * Test seam: how to load an agent's published keys. The default fetches the
   * directory through the SSRF-safe fetcher, which refuses private addresses,
   * so tests inject their own.
   */
  loadKeys?: (origin: string) => Promise<DirectoryKey[] | null | "budget">;
  /**
   * Called when a directory fetch succeeds, so the keys can be kept for the
   * enforcement feed to distribute. Fire-and-forget: this module verifies
   * signatures and must not depend on, or be slowed by, storage.
   */
  onKeysLoaded?: (origin: string, keys: DirectoryKey[]) => void;
};

export async function verifyWebBotAuth(request: Request, options: VerifyOptions = {}): Promise<WebBotAuthResult> {
  if (!request.headers.get("signature") || !request.headers.get("signature-input")) return { ok: false, reason: "not-signed" };
  const header = request.headers.get("signature-agent");
  if (!header) return { ok: false, reason: "no-agent" };

  let origin: string;
  try {
    const entries = parseSignatureAgentHeader(header).entries;
    const entry = entries.find((e) => e.type === "directory") ?? entries[0];
    const url = new URL(entry.uri);
    if (url.protocol !== "https:") return { ok: false, reason: "no-agent" };
    origin = url.origin;
  } catch {
    return { ok: false, reason: "no-agent" };
  }

  const keys = await (options.loadKeys ?? directoryKeys)(origin);
  if (keys === "budget") return { ok: false, reason: "budget" };
  if (!keys) return { ok: false, reason: "directory-unavailable" };
  options.onKeysLoaded?.(origin, keys);

  try {
    const verified = await verify(request, { resolver: (candidate) => verifierFor(candidate, keys) });
    // Only a covered component is tamper-evident: altering or removing a
    // covered header breaks the signature, while an appended one leaves a
    // valid signature that simply never covered it.
    const components = verified.components
      .map((component) => (typeof component === "string" ? component : component.name))
      .filter((name): name is string => typeof name === "string")
      .map((name) => name.toLowerCase());
    const covered = components.includes(INTENT_HEADER);
    return {
      ok: true,
      identity: origin,
      keyid: verified.keyid,
      expires: verified.expires,
      declaration: covered ? parseIntentDeclaration(request.headers.get(INTENT_HEADER)) : null,
      components,
    };
  } catch {
    return { ok: false, reason: "unverified" };
  }
}

/** Test seam: drops cached directories and resets the fetch budget. */
export function resetWebBotAuthCache() {
  directoryCache.clear();
  FETCH_BUDGET.used = 0;
  FETCH_BUDGET.windowStart = 0;
}
