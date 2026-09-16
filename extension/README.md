# TrustTab browser extension

A Chrome extension (Manifest V3) that shows whether the site you're on is
verified by TrustTab.

## Modes

- **Verified** shows TrustTab's verification for the current site:
  - **Verified** (green): every automated check passed.
  - **Self-declared** (blue): checks passed, but some forms are declared by
    the owner and not confirmed. The popup lists them.
  - **Needs re-check** (yellow): the site's checks aren't passing or its
    verification expired. If a check found content that could mislead AI
    agents, the popup says so explicitly.
  - **Not verified** (grey): no information. This is neutral, never a warning.
- **AI Check** opens with a **summary badge** for the concrete safety checks
  below: green ("No concerns found in our checks", which is not a promise the
  page is safe), yellow ("Something to review") when exactly one check fired,
  or red ("Multiple signs of a possible scam") when two or more *different*
  checks fired. The colour is a mechanical count of which checks fired, never
  a judgment of severity, and every finding is listed under the badge. Two
  checks feed it:
  - **Sensitive-info request**: a chat or form on the page asks for something
    credential-shaped (password, PIN, one-time code, full card number, CVV,
    Social Security number, bank details, wallet recovery phrase, remote
    access) **and** applies urgency (suspension, "act now", a deadline, a
    threat of loss). Either alone is normal and never reported. Blocks that
    warn about such requests ("we will never ask for your password") are
    excluded. The finding quotes the page's own words.
  - **Domain lookalike**: the page's domain resembles a frequently spoofed
    brand's domain without being it, by homoglyph or typo substitution
    (`paypa1.com`, `arnazon.com`, internationalized domains are decoded
    first), a near-miss ending (`paypal.co`), or the brand's name as a
    separate part of another domain (`paypal-secure.com`,
    `paypal.com.login-check.net`). Brand domains and their subdomains never
    match. Names that are ordinary words (apple, target, chase) only match on
    near-miss spellings, so `apple-pie-recipes.com` is not a finding.

  Detecting AI applications, AI agent widgets, chat widgets, or anything from
  the writing and image estimates **never** affects the badge: AI use is
  reported as a fact, not as a safety concern.
- **AI Check** is a separate feature, deliberately kept apart from
  verification (its own violet styling, never green/blue/yellow). Today it
  detects AI applications and chat widgets on the page:
  - **Native AI application detected: [name]** when the page itself is an AI
    assistant (Claude, ChatGPT, Gemini, Copilot, Perplexity and others),
    matched on the page's own domain. It identifies the site only, and says
    nothing about whether any text on the page was written by AI.
  - **AI agent widget detected: [name]** for AI-native products (Chatbase,
    Voiceflow, Botpress, Ada).
  - **Chat widget detected: [name]** for chat and help-desk tools whose vendors
    offer AI agents (Intercom, Drift, Zendesk, Crisp, Tidio, HubSpot chat,
    LiveChat, Freshchat, Tawk.to). The popup says that whether AI answers can't
    be seen from the page, rather than claiming it does.
  - Each result lists the exact script host or page element that matched.
    This is pattern matching, stated as fact, with no model or estimate
    involved. "None found" names how many providers were checked and doesn't
    claim the page has no AI.

  - **Writing estimate** is a separate button, **Check this page's writing**.
    Only when you click it, the popup reads the page's main text (the
    `<main>`/`<article>` if there is one, without navigation, headers,
    footers, sidebars, forms, buttons or hidden text), up to about 2,000
    words, and sends that text alone to TrustTab. TrustTab asks Anthropic's
    Claude for an estimate. The result is always one of **Likely AI-written
    (estimate)**, **Can't tell (estimate)** or **Likely human-written
    (estimate)**, with the model's one-sentence reason and a warning that
    AI-text detection is often wrong. Pages with under 150 words get "Not
    enough text to estimate" and nothing is sent.
  - **Image check** runs in steps, each from a click. **Find images on this
    page** lists visible images of at least 200px. Picking one reads the
    image file in your browser and checks, in order:
    1. **Content Credentials (C2PA)**, validated with the official c2pa-rs
       WebAssembly build against the official C2PA Trust List, then the
       interim Content Credentials list. A trusted signature is shown as
       **verified** (solid card): who signed and what they state, such as
       "created with generative AI". The popup notes that a signature proves
       who made the statements and that the file is unchanged, not that the
       statements are true.
    2. **Unverified information** (hatched card): credentials from a signer
       that isn't on a trust list, credentials that failed validation, or
       unsigned metadata that mentions AI (IPTC digital source type,
       Stable Diffusion/ComfyUI generation settings, AI generator names).
       Anyone can edit these, and the popup says so.
    3. **Nothing found** (plain card), which is common: most sites strip
       metadata.

    Unless credentials were verified, **Ask for an estimate** sends a copy
    of the image, downscaled to at most 1024px, to TrustTab, which asks
    Claude. The result (dashed card) is either **Possibly AI-generated
    (estimate, no verified metadata found)**, listing the concrete signs the
    model reports (for example garbled text) so you can look yourself, or
    **No clear signs of AI generation (estimate, no verified metadata
    found)**. It never says an image is real.

## Privacy and permissions

- Permissions are **`activeTab`** and **`scripting`**, plus **optional**
  host permissions that are requested one site at a time, only for the image
  check (see below). `activeTab` gives the
  popup the address of the tab you're on, and only after you click the toolbar
  button. `scripting` lets it run the widget check in that tab, which
  `activeTab` also limits to the tab you clicked on. There are no host
  permissions and no content scripts.
- The widget check runs only when you open the **AI Check** tab. It reads
  script/iframe addresses and a list of element selectors, returns hostnames
  and matched selectors to the popup, and makes **no network requests**.
- The writing estimate is the only feature that sends page content off your
  device, and only when you click its button. It sends the extracted text
  without the page address or title, and without cookies. TrustTab doesn't
  log or store the text. Anthropic processes it under its commercial
  API terms, including its data retention policy. Checks
  are rate-limited per IP address (10 per hour, 30 per day).
- The image check reads images in your browser. Listing images and reading
  their metadata send nothing. If an image is on another site that doesn't
  allow reading its files, the popup asks you to grant access to that one
  site (an optional host permission, requested only when you click).
  Thumbnails in the popup load from the image's own address, without a
  referrer.
- **Ask for an estimate** is the only image step that sends anything: a
  downscaled JPEG copy (which drops the file's metadata), with no page
  address and no cookies. Photos of people are sent too. TrustTab doesn't log
  or store the image, and image estimates have their own per-IP limits (10 per
  hour, 30 per day).
- The extension sends that tab's domain to TrustTab **only when you open the
  popup**. It does not watch your browsing, run on the pages you visit, or
  send anything in the background.
- Lookups go to TrustTab's public API without cookies. The extension doesn't
  know whether you're signed in to TrustTab. "Open in TrustTab" opens your
  dashboard, which handles that.

## Build and install (development)

```bash
npm install
npm run ext:build            # builds extension/dist/ against https://trusttab-mu.vercel.app
```

Then in Chrome: open `chrome://extensions`, turn on **Developer mode**, click
**Load unpacked**, and choose the `extension/dist` folder.

To point it at another TrustTab instance (for example your own, or local
development):

```bash
TRUSTTAB_URL=http://localhost:3000 npm run ext:build
```

Rebuild, then click the reload icon on the extension's card in
`chrome://extensions`.

### Working on the popup without reloading the extension

```bash
TRUSTTAB_URL=http://localhost:3000 npm run ext:build
npm run ext:preview
# open http://127.0.0.1:5174/popup.html?url=https://example.com
```

Outside the extension there is no tab API, so the popup takes the page address
from `?url=`.

## Checks

```bash
npm run ext:typecheck
npm test                     # includes extension/src/*.test.ts
```

The popup's status wording lives in `src/lib/registry-display.ts` in the main
app, and domain handling in `src/lib/domain.ts`, both shared with the server so
the two can't drift apart.

## Adding a chat or AI widget provider

Append an entry to `src/widget-signatures.ts`. That list is the only place
providers are defined. Spoofed brands for the domain-lookalike check live in
`src/lookalike-brands.ts` the same way, and both go stale over time. For an AI application, use `kind: "ai_application"`
with `pageDomains` (the domains the app itself runs on); it matches the
page's own address, so visiting another site that merely loads something
from it never counts. For widgets, use hosts only if loading anything from
them means the widget is installed. If the vendor's host also serves other files (Zendesk's
`static.zdassets.com`, HubSpot's `js.usemessages.com`), use an element or
`script[src*=…]` selector instead. `npm test` checks the list's shape.

## Layout

```
extension/
  manifest.json      MV3 manifest (activeTab + scripting; optional host permissions)
  popup.html/.css    popup UI
  src/popup.ts       reads the active tab, renders the result
  src/lookup.ts      tab URL → domain; calls GET /api/verify/by-domain/:domain
  src/widget-signatures.ts  the list of known chat / AI agent widgets
  src/widgets.ts     in-page evidence collector, matching, AI Check wording
  src/text-extract.ts  in-page main-text extraction (run on click only)
  src/text-estimate.ts calls POST /api/ai-check/text; wording is in src/lib/ai-text/display.ts
  src/image-check.ts   image listing, reading image bytes, estimate request
  src/c2pa-worker.ts   worker that validates Content Credentials (c2pa-rs WebAssembly)
  src/provenance.ts    credentials/metadata interpretation, unsigned AI markers, tier wording
  src/sensitive-request.ts  credential-request + urgency patterns, in-page text collection
  src/lookalike.ts     domain similarity checks (punycode, homoglyphs, edit distance)
  src/lookalike-brands.ts   the list of frequently spoofed brands
  src/safety-badge.ts  green/yellow/red summary, a count of which checks fired
  trust/               committed C2PA trust lists (update: node extension/update-trust-lists.mjs)
  build.mjs          esbuild bundle → dist/
  make-icons.mjs     generates icons/ (no image dependencies)
  preview.mjs        serves dist/ for popup development
```
