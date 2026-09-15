/**
 * Returns an error message if `request` isn't a same-origin request made by a
 * browser from this app's own pages (matching `Origin` and
 * `Sec-Fetch-Site: same-origin`), or null if it is.
 *
 * Browsers set both headers themselves and pages can't forge them, so this
 * blocks cross-site requests and requests made from other sites' pages. A
 * non-browser client can still send any headers, so this is defense in depth
 * for sensitive actions, not proof that a human clicked. See publish-gate.ts.
 */
export function sameOriginBrowserRequestError(request: Request, appUrl = process.env.BETTER_AUTH_URL): string | null {
  const expected = new URL(appUrl ?? request.url).origin;
  if (request.headers.get("origin") !== expected) return "This action must be done from the TrustTab dashboard.";
  if (request.headers.get("sec-fetch-site") !== "same-origin") return "This action must be done from the TrustTab dashboard.";
  return null;
}
