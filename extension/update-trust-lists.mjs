#!/usr/bin/env node
/**
 * Downloads the certificate trust lists the extension uses to verify Content
 * Credentials (C2PA) and writes them to extension/trust/. They are committed,
 * so builds are reproducible and the extension never fetches them at runtime.
 * Re-run periodically; the lists change as signers are added or removed.
 *
 *   node extension/update-trust-lists.mjs
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "trust");

const SOURCES = {
  // The official C2PA Trust List (C2PA conformance program).
  "c2pa-trust-list.pem": "https://raw.githubusercontent.com/c2pa-org/conformance-public/main/trust-list/C2PA-TRUST-LIST.pem",
  // The interim Content Credentials list used by contentcredentials.org/verify.
  // Temporary and being phased out, but many existing images chain to it.
  "interim-anchors.pem": "https://contentcredentials.org/trust/anchors.pem",
  // SHA-256 hashes of individually allowed signing certificates.
  "interim-allowed.sha256.txt": "https://contentcredentials.org/trust/allowed.sha256.txt",
  "interim-store.cfg": "https://contentcredentials.org/trust/store.cfg",
};

const retrieved = new Date().toISOString().slice(0, 10);
for (const [file, url] of Object.entries(SOURCES)) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const text = await response.text();
  if (file.endsWith(".pem") && !text.includes("BEGIN CERTIFICATE")) throw new Error(`${url}: not a PEM bundle`);
  writeFileSync(path.join(dir, file), text);
  console.log(`${file}: ${text.length} bytes`);
}
writeFileSync(path.join(dir, "RETRIEVED.json"), `${JSON.stringify({ retrieved, sources: SOURCES }, null, 2)}\n`);
