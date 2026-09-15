#!/usr/bin/env node
/**
 * Serves the built popup as a normal web page, for working on the UI without
 * reloading the extension:
 *
 *   TRUSTTAB_URL=http://localhost:3000 npm run ext:build
 *   npm run ext:preview
 *   open http://127.0.0.1:5174/popup.html?url=https://example.com
 *
 * Outside the extension there's no chrome.tabs, so the popup reads the page
 * address from `?url=` instead.
 */
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), "dist");
const port = Number(process.env.PORT ?? 5174);
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".pem": "text/plain",
  ".cfg": "text/plain",
  ".txt": "text/plain",
};

createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
  const file = path.normalize(path.join(dist, pathname === "/" ? "popup.html" : pathname));
  if (!file.startsWith(dist + path.sep) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404).end("Not found");
    return;
  }
  const type = types[path.extname(file)] ?? "application/octet-stream";
  // Same CSP as MV3 extension pages, so the preview catches CSP problems.
  res.writeHead(200, {
    "content-type": /^(text|application\/json)/.test(type) ? `${type}; charset=utf-8` : type,
    "content-security-policy": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
  });
  createReadStream(file).pipe(res);
}).listen(port, "127.0.0.1", () => console.log(`Popup preview at http://127.0.0.1:${port}/popup.html?url=https://example.com`));
