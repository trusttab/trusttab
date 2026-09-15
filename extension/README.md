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
- **AI Check** is a separate feature, deliberately kept apart from
  verification (its own violet styling, never green/blue/yellow). Today it
  detects chat and AI agent widgets on the page:
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

  An estimate of AI-generated text is planned and not built.

## Privacy and permissions

- Permissions are **`activeTab`** and **`scripting`**. `activeTab` gives the
  popup the address of the tab you're on, and only after you click the toolbar
  button. `scripting` lets it run the widget check in that tab, which
  `activeTab` also limits to the tab you clicked on. There are no host
  permissions and no content scripts.
- The widget check runs only when you open the **AI Check** tab. It reads
  script/iframe addresses and a list of element selectors, returns hostnames
  and matched selectors to the popup, and makes **no network requests**.
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
providers are defined. Use hosts only if loading anything from them means the
widget is installed. If the vendor's host also serves other files (Zendesk's
`static.zdassets.com`, HubSpot's `js.usemessages.com`), use an element or
`script[src*=…]` selector instead. `npm test` checks the list's shape.

## Layout

```
extension/
  manifest.json      MV3 manifest (activeTab + scripting)
  popup.html/.css    popup UI
  src/popup.ts       reads the active tab, renders the result
  src/lookup.ts      tab URL → domain; calls GET /api/verify/by-domain/:domain
  src/widget-signatures.ts  the list of known chat / AI agent widgets
  src/widgets.ts     in-page evidence collector, matching, AI Check wording
  build.mjs          esbuild bundle → dist/
  make-icons.mjs     generates icons/ (no image dependencies)
  preview.mjs        serves dist/ for popup development
```
