/**
 * AI Check, Addition 4: does this page's domain closely resemble a
 * frequently spoofed brand's domain without being it?
 *
 * Measurable only: homoglyph and typo substitution (after decoding
 * internationalized domains), a near-miss domain ending, or the brand's name
 * used as a separate part of someone else's domain. No tone or content
 * judgment, and nothing is ever reported for the brand's own domains.
 *
 * Brands live in ./lookalike-brands.ts.
 */

import { SPOOFED_BRANDS, type Brand } from "./lookalike-brands";

/** Multi-part public suffixes, so "amazon.co.uk" is one registrable domain, not "co.uk". */
const MULTI_PART_SUFFIXES = [
  "co.uk", "org.uk", "gov.uk", "ac.uk", "me.uk", "net.uk", "sch.uk",
  "com.au", "net.au", "org.au", "gov.au", "edu.au",
  "co.jp", "ne.jp", "or.jp", "go.jp", "ac.jp",
  "com.br", "com.mx", "com.ar", "com.co", "com.pe",
  "co.nz", "co.za", "co.in", "co.kr", "co.il", "co.th", "co.id",
  "com.sg", "com.my", "com.hk", "com.tw", "com.cn", "com.tr", "com.ua", "com.pl", "com.es", "com.pt",
  "gov.in", "gov.br", "gov.za",
];

export function registrableDomain(host: string): { label: string; suffix: string; domain: string } | null {
  const clean = host.toLowerCase().replace(/\.+$/, "");
  if (!clean.includes(".") || /^\d+\.\d+\.\d+\.\d+$/.test(clean)) return null;
  const parts = clean.split(".");
  const suffix = MULTI_PART_SUFFIXES.find((s) => clean.endsWith(`.${s}`)) ?? parts[parts.length - 1];
  const suffixParts = suffix.split(".").length;
  const label = parts[parts.length - suffixParts - 1];
  return label ? { label, suffix, domain: `${label}.${suffix}` } : null;
}

/** Decodes a punycode label ("xn--pypal-4ve" → "pаypal"), so homoglyphs can be compared. RFC 3492. */
export function decodePunycode(label: string): string {
  if (!label.startsWith("xn--")) return label;
  const input = label.slice(4);
  const [basic, encoded] = input.lastIndexOf("-") > 0 ? [input.slice(0, input.lastIndexOf("-")), input.slice(input.lastIndexOf("-") + 1)] : ["", input];
  const output = [...basic].map((c) => c.codePointAt(0)!);
  let n = 128;
  let i = 0;
  let bias = 72;
  let index = 0;
  while (index < encoded.length) {
    const oldi = i;
    let w = 1;
    for (let k = 36; ; k += 36) {
      if (index >= encoded.length) return label;
      const code = encoded.charCodeAt(index++);
      const digit = code - 48 < 10 ? code - 22 : code - 65 < 26 ? code - 65 : code - 97 < 26 ? code - 97 : 36;
      if (digit >= 36) return label;
      i += digit * w;
      const t = k <= bias ? 1 : k >= bias + 26 ? 26 : k - bias;
      if (digit < t) break;
      w *= 36 - t;
    }
    const delta = Math.floor((i - oldi) / (oldi === 0 ? 700 : 2));
    let k = 0;
    let scaled = delta + Math.floor(delta / (output.length + 1));
    for (; scaled > 455; k += 36) scaled = Math.floor(scaled / 35);
    bias = k + Math.floor((36 * scaled) / (scaled + 38));
    n += Math.floor(i / (output.length + 1));
    i %= output.length + 1;
    output.splice(i++, 0, n);
  }
  return String.fromCodePoint(...output);
}

/**
 * Characters that read as Latin letters: digits and letter pairs used in
 * typo-squatting, plus Cyrillic and Greek homoglyphs. Normalizing both sides
 * makes "paypa1", "pаypal" (Cyrillic а) and "arnazon" comparable.
 */
const CONFUSABLES: Record<string, string> = {
  "0": "o", "1": "l", "3": "e", "4": "a", "5": "s", "6": "g", "7": "t", "8": "b", "9": "g",
  "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "у": "y", "х": "x", "і": "i", "ј": "j", "ѕ": "s", "ԁ": "d", "һ": "h", "ӏ": "l", "м": "m", "т": "t", "в": "b", "н": "h", "к": "k",
  "α": "a", "ο": "o", "ρ": "p", "ε": "e", "ι": "i", "κ": "k", "ν": "v", "τ": "t", "υ": "u", "χ": "x",
};

/** Maps confusable characters to Latin, keeping separators. */
export function mapConfusables(value: string): string {
  return [...value.toLowerCase()].map((c) => CONFUSABLES[c] ?? c).join("").replace(/rn/g, "m").replace(/vv/g, "w");
}

/** As mapConfusables, but also drops separators, for comparing whole names. */
export function normalizeConfusables(value: string): string {
  return mapConfusables(value).replace(/[^a-z0-9]/g, "");
}

/** Damerau-Levenshtein distance, capped for speed. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const rows: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) rows[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + cost);
    }
  }
  return rows[a.length][b.length];
}

export type LookalikeFinding = {
  brand: string;
  /** The brand domain it resembles. */
  brandDomain: string;
  /** The page's own registrable domain. */
  domain: string;
  kind: "character-substitution" | "lookalike-ending" | "brand-in-other-domain";
};

function brandLabels(brand: Brand): { label: string; suffix: string; domain: string }[] {
  return brand.domains.map((d) => registrableDomain(d)).filter((r): r is { label: string; suffix: string; domain: string } => r !== null);
}

/**
 * Reports one finding if `host` resembles a brand domain without being it, or
 * null. A page on the brand's own domain (or a subdomain of it) never
 * produces a finding.
 */
export function checkLookalike(host: string, brands: Brand[] = SPOOFED_BRANDS): LookalikeFinding | null {
  const parsed = registrableDomain(host);
  if (!parsed) return null;
  const labels = host.toLowerCase().split(".").map(decodePunycode);
  const decodedLabel = decodePunycode(parsed.label);
  const normalizedLabel = normalizeConfusables(decodedLabel);

  // The brand's own domains are never a lookalike of themselves.
  for (const brand of brands) {
    if (brand.domains.some((d) => parsed.domain === d)) return null;
  }

  const findings: LookalikeFinding[] = [];
  for (const brand of brands) {
    for (const real of brandLabels(brand)) {
      const normalizedBrand = normalizeConfusables(real.label);
      if (normalizedBrand.length < 4) continue;
      const finding = (kind: LookalikeFinding["kind"]): LookalikeFinding => ({ brand: brand.name, brandDomain: real.domain, domain: parsed.domain, kind });
      const sameSpelling = normalizedLabel === normalizedBrand;
      const sameSuffix = parsed.suffix === real.suffix;

      // 1. The brand's name, written differently: "paypa1", "arnazon", Cyrillic "pаypal".
      //    (The brand's own domains returned null above, so this is never the real one.)
      if (sameSpelling && sameSuffix) {
        findings.push(finding("character-substitution"));
        continue;
      }

      // 2. The brand's exact name on a different ending: paypal.co, paypal.cm. For
      //    brands whose name is an ordinary word, only a near-miss ending counts,
      //    since "apple.fr" style domains are often unrelated businesses.
      if (sameSpelling && !sameSuffix) {
        if (!brand.commonWord || editDistance(parsed.suffix, real.suffix) <= 1) findings.push(finding("lookalike-ending"));
        continue;
      }

      // 3. A near-miss spelling on the same ending: "netfl1x.com", "gogle.com".
      if (!sameSpelling && sameSuffix && normalizedBrand.length >= 5 && editDistance(normalizedLabel, normalizedBrand) <= 1) {
        findings.push(finding("character-substitution"));
        continue;
      }

      // 4. The brand's name as a separate part of someone else's domain:
      //    "paypal-secure.com", "secure-paypal.net", "paypal.com.login-check.net".
      if (!brand.commonWord && brand.token.length >= 5) {
        const token = normalizeConfusables(brand.token);
        const parts = labels.flatMap((label) => mapConfusables(label).split(/[-_]/));
        if (parts.some((part) => normalizeConfusables(part) === token)) findings.push(finding("brand-in-other-domain"));
      }
    }
  }

  // Prefer the most specific kind, so one domain yields one clear statement.
  const order: LookalikeFinding["kind"][] = ["character-substitution", "lookalike-ending", "brand-in-other-domain"];
  return findings.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))[0] ?? null;
}

/** The sentence shown for a finding. Factual similarity, never an accusation. */
export function describeLookalike(finding: LookalikeFinding): string {
  switch (finding.kind) {
    case "character-substitution":
      return `This page's domain (${finding.domain}) is spelled almost like ${finding.brandDomain}, ${finding.brand}'s domain, but isn't the same domain.`;
    case "lookalike-ending":
      return `This page's domain (${finding.domain}) uses ${finding.brand}'s name with a different ending than ${finding.brandDomain}, ${finding.brand}'s domain.`;
    case "brand-in-other-domain":
      return `This page's domain (${finding.domain}) contains ${finding.brand}'s name but isn't ${finding.brandDomain}, ${finding.brand}'s domain.`;
  }
}
