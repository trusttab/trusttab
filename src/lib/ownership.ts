import "server-only";

import { randomBytes } from "node:crypto";

import * as cheerio from "cheerio";

import { fetchSitePage } from "./site-fetch";

/** Name of the meta tag a site owner adds to their homepage to prove control. */
export const VERIFY_META_NAME = "agenttrust-verify";

/** 32 characters of URL-safe randomness (192 bits). */
export function generateVerificationToken(): string {
  return randomBytes(24).toString("base64url");
}

export function verificationSnippet(token: string): string {
  return `<meta name="${VERIFY_META_NAME}" content="${token}">`;
}

/**
 * Returns the `content` of every agenttrust-verify meta tag in the document
 * `<head>`. Tags in `<body>` are ignored on purpose (see checkDomainOwnership).
 */
export function findVerificationTokens(html: string): string[] {
  const $ = cheerio.load(html);
  return $(`head meta[name="${VERIFY_META_NAME}" i]`)
    .map((_, el) => ($(el).attr("content") ?? "").trim())
    .get();
}

export type OwnershipCheckResult =
  | { verified: true; checkedUrl: string }
  | { verified: false; checkedUrl: string; reason: string };

/**
 * Fetches https://<domain>/ and looks for
 * `<meta name="agenttrust-verify" content="<token>">` inside `<head>`.
 *
 * Only the document head counts: body content is often user-generated
 * (comments, reviews, CMS blocks), and we don't want someone who can post a
 * comment on a site to be able to claim it.
 *
 * Redirects are followed only between `domain` and `www.domain`, so an open
 * redirect elsewhere can't be used to satisfy the check.
 */
export async function checkDomainOwnership(
  domain: string,
  token: string,
): Promise<OwnershipCheckResult> {
  const { requestedUrl, result: res } = await fetchSitePage(domain, "/");
  let checkedUrl = requestedUrl;

  if (!res.ok) return { verified: false, checkedUrl, reason: res.error };
  checkedUrl = res.finalUrl;

  if (res.status >= 400) {
    return {
      verified: false,
      checkedUrl,
      reason: `Your homepage returned HTTP ${res.status}.`,
    };
  }

  const contents = findVerificationTokens(res.body);
  if (contents.includes(token)) return { verified: true, checkedUrl };

  if (contents.length > 0) {
    return {
      verified: false,
      checkedUrl,
      reason: `Found an ${VERIFY_META_NAME} tag, but its content doesn't match this site's token. Copy the snippet again.`,
    };
  }

  return {
    verified: false,
    checkedUrl,
    reason: `No <meta name="${VERIFY_META_NAME}"> tag found in the <head> of ${checkedUrl}. If you just added it, your site may be serving a cached page.`,
  };
}
