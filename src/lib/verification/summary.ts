import type { CheckId, CheckResult } from "./types";

/**
 * The site's state in plain language, for the top of the dashboard.
 *
 * The dashboard's detail — raw manifest JSON, redirect config, per-check
 * output, request logs — is written for someone who reads HTTP for a living.
 * Most owners of the sites this is built for don't, and they were meeting all
 * of it first. This states the same facts in words, and the detail stays one
 * click away rather than going anywhere.
 *
 * It is derived, not generated: every sentence comes from the stored run and
 * manifest, so it says the same thing on every load, needs no model, and still
 * works on a deployment with no ANTHROPIC_API_KEY (where the assistant, which
 * can explain further on request, isn't available at all).
 */

export type SummaryTone = "good" | "info" | "bad" | "neutral";

export type SummaryAction = {
  /** What the owner should do, as a task rather than a status. */
  text: string;
  /** The section of the page that does it, for a jump link. */
  target?: "ownership" | "forms" | "checks" | "manifest";
};

export type SiteSummary = {
  headline: string;
  /** One or two sentences of plain explanation. */
  detail: string;
  tone: SummaryTone;
  /** What the badge on their site is showing visitors right now. */
  badgeText: string | null;
  actions: SummaryAction[];
};

export type SiteSummaryInput = {
  status: string;
  ownershipVerified: boolean;
  hasManifest: boolean;
  expiresAt: Date | null;
  lastRunAt: Date | null;
  checks: CheckResult[];
  now?: Date;
};

const DAY = 86_400_000;
/** How close to expiry the summary starts asking for a re-check. */
export const EXPIRY_WARNING_DAYS = 7;

const date = (value: Date) => value.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });

/**
 * What a failed check means for the owner, in words they can act on. Keyed by
 * check so the wording is in one place; the check's own message stays visible
 * in the technical detail, unchanged.
 */
function failureText(check: CheckResult): string {
  const failed = check.details.filter((d) => !d.passed && !d.selfDeclared);
  const subjects = failed.map((d) => d.subject);
  const list = subjects.length > 0 ? ` (${subjects.slice(0, 3).join(", ")}${subjects.length > 3 ? ", and more" : ""})` : "";

  const texts: Record<CheckId, string> = {
    endpoint_match: `TrustTab couldn't find ${failed.length === 1 ? "one of the forms" : `${failed.length || "some"} of the forms`} you declared on the page you declared it on${list}.`,
    injection_scan: `A page on your site contains hidden text written to influence AI agents${list}. That's what this check looks for, and it's why the badge won't say verified.`,
    ssl: "TrustTab couldn't confirm a secure (HTTPS) connection to your site.",
    domain_match: `Your site isn't serving the signed list of forms TrustTab published for it${list}, so a visiting agent can't confirm the two match.`,
    expiry: "The signed list of forms published for your site has passed its expiry date.",
  };
  return texts[check.id];
}

/** Turns a failed check into the task that clears it. */
function actionFor(check: CheckResult): SummaryAction {
  switch (check.id) {
    case "endpoint_match":
      return { text: "Check the form's address and field names, or mark it as self-declared if it's built by JavaScript.", target: "forms" };
    case "injection_scan":
      return { text: "Find and remove the hidden text, then run the check again.", target: "checks" };
    case "ssl":
      return { text: "Make sure your site loads over https:// , then run the check again.", target: "checks" };
    case "domain_match":
      return { text: "Point your site at the signed list TrustTab published, then run the check again.", target: "manifest" };
    case "expiry":
      return { text: "Run the check again to publish a fresh copy.", target: "checks" };
  }
}

export function summarizeSite(input: SiteSummaryInput): SiteSummary {
  const now = input.now ?? new Date();

  if (!input.ownershipVerified) {
    return {
      headline: "Confirm this site is yours",
      detail:
        "TrustTab needs to see a short tag on your homepage before it can vouch for anything about your site. Nothing else here works until then.",
      tone: "neutral",
      badgeText: null,
      actions: [{ text: "Add the tag to your homepage, then confirm ownership.", target: "ownership" }],
    };
  }

  if (!input.hasManifest) {
    return {
      headline: "Tell TrustTab which forms agents may use",
      detail:
        "You own this site. The next step is listing the forms an AI agent is welcome to fill in — a contact form, a booking request — so TrustTab can check them and vouch for them.",
      tone: "neutral",
      badgeText: null,
      actions: [{ text: "Declare your forms and publish them.", target: "forms" }],
    };
  }

  if (!input.lastRunAt || input.checks.length === 0) {
    return {
      headline: "Ready to be checked",
      detail:
        "Your forms are published. TrustTab hasn't checked them against your live site yet, so your badge doesn't say anything about them yet.",
      tone: "neutral",
      badgeText: "Not verified",
      actions: [{ text: "Run the checks against your live site.", target: "checks" }],
    };
  }

  const checked = `checked on ${date(input.lastRunAt)}`;
  const failing = input.checks.filter(
    (check) => !check.passed && !(check.details.length > 0 && check.details.every((d) => d.passed || d.selfDeclared)),
  );
  const selfDeclaredOnly = input.checks.filter(
    (check) => !check.passed && check.details.length > 0 && check.details.every((d) => d.passed || d.selfDeclared),
  );

  const actions: SummaryAction[] = failing.map(actionFor);

  // Expiry is a deadline rather than a failure, so it is added to whatever the
  // checks said rather than replacing it.
  const expiring =
    input.expiresAt && input.status !== "pending" ? Math.ceil((input.expiresAt.getTime() - now.getTime()) / DAY) : null;
  if (expiring !== null && expiring <= 0) {
    actions.push({ text: "Run the checks again to renew it.", target: "checks" });
  } else if (expiring !== null && expiring <= EXPIRY_WARNING_DAYS) {
    actions.push({ text: `Run the checks again before ${date(input.expiresAt!)} to keep your badge current.`, target: "checks" });
  }

  const expiryNote =
    expiring !== null && expiring <= 0
      ? " What you published has expired, so agents checking it now see an out-of-date badge."
      : expiring !== null && expiring <= EXPIRY_WARNING_DAYS
        ? ` It expires on ${date(input.expiresAt!)}.`
        : "";

  if (input.status === "verified") {
    return {
      headline: "Your site is verified",
      detail: `Every check passed when TrustTab last looked at your live site, ${checked}. Your badge is live and anyone can confirm it.${expiryNote}`,
      tone: expiring !== null && expiring <= 0 ? "bad" : "good",
      badgeText: "Verified",
      actions,
    };
  }

  if (input.status === "self_declared") {
    const count = selfDeclaredOnly.reduce((total, check) => total + check.details.filter((d) => d.selfDeclared).length, 0);
    return {
      headline: "Your site is self-declared",
      detail: `Everything TrustTab could check passed, ${checked}, but ${count === 1 ? "one form" : `${count} forms`} couldn't be seen automatically — usually because ${count === 1 ? "it's" : "they're"} built by JavaScript after the page loads. You've declared ${count === 1 ? "it" : "them"} yourself, so your badge says "Self-declared" rather than "Verified", and your public page lists which ones.${expiryNote}`,
      tone: "info",
      badgeText: "Self-declared",
      actions,
    };
  }

  if (failing.length > 0) {
    const first = failing[0];
    const others = failing.length > 1 ? ` ${failing.length - 1} other check${failing.length > 2 ? "s" : ""} also didn't pass.` : "";
    return {
      headline: failing.length === 1 ? "One check didn't pass" : `${failing.length} checks didn't pass`,
      detail: `${failureText(first)}${others} Last ${checked}. Until this is fixed your badge won't say verified.${expiryNote}`,
      tone: "bad",
      badgeText: "Needs re-check",
      actions,
    };
  }

  return {
    headline: "Checked, not yet verified",
    detail: `TrustTab last looked at your live site ${checked}. Your badge doesn't claim verification yet.${expiryNote}`,
    tone: "neutral",
    badgeText: "Not verified",
    actions,
  };
}
