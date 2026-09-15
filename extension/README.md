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
- **AI Check**: coming soon. It is a separate feature, deliberately kept apart
  from verification.

## Privacy and permissions

- The only permission is **`activeTab`**, which lets the popup read the
  address of the tab you're on, and only after you click the toolbar button.
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

## Layout

```
extension/
  manifest.json      MV3 manifest (activeTab only)
  popup.html/.css    popup UI
  src/popup.ts       reads the active tab, renders the result
  src/lookup.ts      tab URL → domain; calls GET /api/verify/by-domain/:domain
  build.mjs          esbuild bundle → dist/
  make-icons.mjs     generates icons/ (no image dependencies)
  preview.mjs        serves dist/ for popup development
```
