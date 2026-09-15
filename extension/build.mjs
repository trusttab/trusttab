#!/usr/bin/env node
/**
 * Builds the TrustTab browser extension into extension/dist/.
 *
 *   npm run ext:build                                   # production TrustTab
 *   TRUSTTAB_URL=http://localhost:3000 npm run ext:build  # a local or self-hosted instance
 *
 * Load extension/dist/ via chrome://extensions → Developer mode → Load unpacked.
 */
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, "dist");
const root = path.join(here, "..");
const apiBase = (process.env.TRUSTTAB_URL ?? "https://trusttab-mu.vercel.app").replace(/\/+$/, "");

try {
  const url = new URL(apiBase);
  if (url.protocol !== "https:" && url.hostname !== "localhost") throw new Error("must be https (or localhost)");
} catch (err) {
  console.error(`Invalid TRUSTTAB_URL "${apiBase}": ${err.message}`);
  process.exit(1);
}

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

await build({
  entryPoints: [path.join(here, "src/popup.ts")],
  outfile: path.join(dist, "popup.js"),
  bundle: true,
  format: "iife",
  target: "chrome120",
  tsconfig: path.join(here, "tsconfig.json"),
  define: { __TRUSTTAB_URL__: JSON.stringify(apiBase) },
  legalComments: "none",
  logLevel: "warning",
});

// The Content Credentials (C2PA) reader: a module worker plus the c2pa-rs
// WebAssembly binary, both served from the extension's own files.
await build({
  entryPoints: [path.join(here, "src/c2pa-worker.ts")],
  outfile: path.join(dist, "c2pa-worker.js"),
  bundle: true,
  format: "esm",
  target: "chrome120",
  tsconfig: path.join(here, "tsconfig.json"),
  legalComments: "none",
  logLevel: "warning",
});
cpSync(path.join(root, "node_modules/@contentauth/c2pa-wasm/pkg/c2pa_bg.wasm"), path.join(dist, "c2pa_bg.wasm"));
cpSync(path.join(here, "trust"), path.join(dist, "trust"), { recursive: true });

for (const file of ["manifest.json", "popup.html", "popup.css"]) {
  cpSync(path.join(here, file), path.join(dist, file));
}
if (!existsSync(path.join(here, "icons/icon-128.png"))) {
  console.error("Icons missing: run `node extension/make-icons.mjs` first.");
  process.exit(1);
}
cpSync(path.join(here, "icons"), path.join(dist, "icons"), { recursive: true });

console.log(`Built extension/dist for ${apiBase}`);
