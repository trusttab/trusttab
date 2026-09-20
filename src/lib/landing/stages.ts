/**
 * The five stages the landing page is built around, and the single source of
 * truth for which of them actually exist.
 *
 * Four are shipped. Protection is not built, and the page must never read as
 * though it were. That is the same rule the rest of the product already lives
 * by — estimates are labelled estimates, a form that can't be confirmed is
 * "Self-declared" and never "Verified", a scope mismatch is stated rather than
 * accused — applied to the marketing surface, which is where overclaiming is
 * easiest and least visible.
 *
 * So `shipped` is a property of the data, not of how someone writes a card:
 * the page renders `SHIPPED_STAGES` and `NEXT_STAGES` separately and
 * `stages.test.ts` pins the split, the absence of a call to action on anything
 * unshipped, and the absence of present-tense capability language in its copy.
 * Add a stage here; don't special-case one in the page.
 */

export type Stage = {
  /** Detection, Verification, … — the stage's place in the narrative. */
  name: string;
  /** What it does for the reader, in their terms. */
  tagline: string;
  shipped: boolean;
  body: string;
  /**
   * An honest limit on a shipped stage: something real that a reader would
   * otherwise discover only after signing up.
   */
  caveat?: string;
  /** Where to go to use it. Only a shipped stage may have one. */
  href?: { label: string; url: string };
};

export const STAGES: Stage[] = [
  {
    name: "Detection",
    tagline: "See what a page is doing",
    shipped: true,
    body:
      "The browser extension's AI Check reads the page you're on and reports what it finds: a native AI application by its domain, chat and AI-agent widgets by their own embed code, and pages claiming a known AI product's name from an unrelated domain. It also estimates whether text or an image was AI-generated — labelled an estimate every time, because that kind of detection is often wrong and shouldn't be used to accuse anyone.",
    caveat: "Not in the Chrome Web Store yet — you can build it from the repository.",
    href: { label: "How the extension works", url: "https://github.com/trusttab/trusttab#browser-extension" },
  },
  {
    name: "Verification",
    tagline: "Prove your forms are what you say",
    shipped: true,
    body:
      "Declare the forms an agent may use. TrustTab fetches your live site, confirms each form exists with the fields you declared, scans for hidden content aimed at agents, and issues a signed badge anyone can check against the public registry. When a form is built by JavaScript and can't be confirmed automatically, your site is marked Self-declared — never Verified — and its public page lists exactly which forms went unconfirmed.",
    href: { label: "Get verified", url: "/signup" },
  },
  {
    name: "Identity",
    tagline: "Know which agent is knocking",
    shipped: true,
    body:
      "Agents that sign their requests (Web Bot Auth, RFC 9421) are identified cryptographically, against keys published by their own operator. Everything else is an estimate and is labelled as one: a known user agent or a published IP range is a good guess, not proof, and unsigned traffic is “unclassified”, which means nothing more than that. TrustTab doesn't issue agent identity or authorize transactions — it checks the signatures agents already present.",
    caveat:
      "Covers requests to your manifest and registry entry with nothing installed. Seeing agents on your own pages needs a collector, currently in limited release.",
  },
  {
    name: "Authorization",
    tagline: "See what an agent said it came to do",
    shipped: true,
    body:
      "A signed agent can declare its purpose and scope — “booking, under /schedule-tour” — in your manifest's own vocabulary. Because the declaration is covered by the signature, it can't be added or altered after signing, and one that wasn't signed is dropped rather than displayed. When a request falls outside the declared scope, your dashboard says so as a fact. It never calls it an attack: a mismatch can be a misconfigured agent, a redirect, or a deliberate deviation, and nothing here can tell which.",
    caveat: "Same coverage as Identity.",
  },
  {
    name: "Protection",
    tagline: "Not built yet",
    shipped: false,
    body:
      "The picture ends with acting on what the first four stages establish: rate-limiting or refusing a request that falls outside a declared scope. None of this exists today. When it is built it will be opt-in and it will fail open — if TrustTab is slow or unreachable, the request goes through regardless, because this must never be able to take a customer's site offline.",
    caveat: "A roadmap item, not a product. No date, and nothing to sign up for.",
  },
];

/** The stages a reader can use today. */
export const SHIPPED_STAGES = STAGES.filter((stage) => stage.shipped);

/** The stages that do not exist yet. Rendered apart, and never as a capability. */
export const NEXT_STAGES = STAGES.filter((stage) => !stage.shipped);
