#!/usr/bin/env node
/**
 * Downloads the IP ranges that AI agent operators publish for their crawlers
 * and fetchers, and writes them to src/lib/agent-traffic/ranges.json.
 *
 * The result is committed, so classification never depends on a network call
 * at request time. Re-run periodically: operators add and remove ranges, and
 * a stale file quietly stops matching (see CLAUDE.md, open questions).
 *
 *   node scripts/update-agent-ranges.mjs
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/lib/agent-traffic/ranges.json");

/** Each entry is one published list. `product` is what the operator calls it. */
const SOURCES = [
  { operator: "OpenAI", product: "GPTBot", url: "https://openai.com/gptbot.json" },
  { operator: "OpenAI", product: "ChatGPT-User", url: "https://openai.com/chatgpt-user.json" },
  { operator: "OpenAI", product: "OAI-SearchBot", url: "https://openai.com/searchbot.json" },
  { operator: "Google", product: "Googlebot", url: "https://developers.google.com/search/apis/ipranges/googlebot.json" },
  { operator: "Google", product: "special crawlers", url: "https://developers.google.com/search/apis/ipranges/special-crawlers.json" },
  { operator: "Google", product: "user-triggered fetchers", url: "https://developers.google.com/search/apis/ipranges/user-triggered-fetchers.json" },
  { operator: "Google", product: "user-triggered fetchers (Google)", url: "https://developers.google.com/search/apis/ipranges/user-triggered-fetchers-google.json" },
  { operator: "Perplexity", product: "PerplexityBot", url: "https://www.perplexity.ai/perplexitybot.json" },
];

const operators = [];
for (const source of SOURCES) {
  const response = await fetch(source.url, { redirect: "follow" });
  if (!response.ok) throw new Error(`${source.url}: HTTP ${response.status}`);
  const body = await response.json();
  const prefixes = (body.prefixes ?? [])
    .map((p) => p.ipv4Prefix ?? p.ipv6Prefix)
    .filter((p) => typeof p === "string" && p.includes("/"));
  if (prefixes.length === 0) throw new Error(`${source.url}: no prefixes`);
  operators.push({ operator: source.operator, product: source.product, url: source.url, prefixes: prefixes.sort() });
  console.log(`${source.operator} ${source.product}: ${prefixes.length} prefixes`);
}

writeFileSync(out, `${JSON.stringify({ retrieved: new Date().toISOString().slice(0, 10), operators }, null, 2)}\n`);
console.log(`Wrote ${out}`);
