import type { PublicStatus } from "./registry";

/**
 * The embeddable badge: one simple, shields-style SVG (custom badge designs
 * are out of scope for now). Pure function so it can be tested and reused.
 */

const STYLES: Record<PublicStatus | "not_found", { text: string; color: string }> = {
  verified: { text: "verified", color: "#15803d" },
  // Deliberately not green: TrustTab has not confirmed every form.
  self_declared: { text: "self-declared", color: "#1d4ed8" },
  pending: { text: "pending", color: "#71717a" },
  needs_fix: { text: "needs fixes", color: "#b45309" },
  failed: { text: "failed", color: "#b91c1c" },
  expired: { text: "expired", color: "#71717a" },
  not_found: { text: "not found", color: "#71717a" },
};

// Approximate width of 11px Verdana/DejaVu Sans glyphs, good enough for
// sizing a short label without a font-metrics dependency.
const textWidth = (text: string) => Math.round(text.length * 6.5 + 10);

const escapeXml = (text: string) =>
  text.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);

export function renderBadge(label: string, status: PublicStatus | "not_found"): string {
  const { text, color } = STYLES[status];
  const left = textWidth(label);
  const right = textWidth(text);
  const width = left + right;
  const title = escapeXml(`${label}: ${text}`);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="20" role="img" aria-label="${title}">
  <title>${title}</title>
  <clipPath id="r"><rect width="${width}" height="20" rx="3"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${left}" height="20" fill="#27272a"/>
    <rect x="${left}" width="${right}" height="20" fill="${color}"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,DejaVu Sans,sans-serif" font-size="11">
    <text x="${left / 2}" y="14">${escapeXml(label)}</text>
    <text x="${left + right / 2}" y="14">${escapeXml(text)}</text>
  </g>
</svg>`;
}
