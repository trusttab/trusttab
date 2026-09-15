import {
  MAX_IMAGE_BYTES,
  MAX_IMAGE_EDGE,
  parseImageEstimateResponse,
  type ImageEstimateOutcome,
} from "@/lib/ai-image/display";

/**
 * AI Check 2c in the popup: listing a page's images, reading one image's
 * bytes, and requesting a Tier 2 estimate. Every step runs from an explicit
 * click. Listing and reading stay in the browser; only the estimate sends
 * anything (a downscaled JPEG, never the page address).
 */

export type ImageCandidate = { src: string; width: number; height: number; alt: string };

/** Largest image file read for a metadata check. */
export const MAX_READ_BYTES = 10 * 1024 * 1024;
const MAX_CANDIDATES = 12;

/**
 * Injected into the active tab: lists visible images at least 200px on the
 * long edge, largest first. Self-contained (Chrome serializes it). Returns
 * addresses, sizes and alt text only.
 */
export function collectImageCandidates(maxCandidates: number): ImageCandidate[] {
  const seen = new Set<string>();
  const found: (ImageCandidate & { area: number })[] = [];
  for (const img of Array.from(document.images)) {
    const src = img.currentSrc || img.src;
    if (!src || seen.has(src) || !/^(https?:|data:image\/|blob:)/.test(src)) continue;
    const width = img.naturalWidth;
    const height = img.naturalHeight;
    if (Math.max(width, height) < 200 || Math.min(width, height) < 50) continue;
    const rect = img.getBoundingClientRect();
    if (rect.width < 40 || rect.height < 40 || !img.checkVisibility({ visibilityProperty: true })) continue;
    seen.add(src);
    found.push({ src, width, height, alt: (img.alt || "").replace(/\s+/g, " ").trim().slice(0, 80), area: rect.width * rect.height });
  }
  return found
    .sort((a, b) => b.area - a.area)
    .slice(0, maxCandidates)
    .map(({ src, width, height, alt }) => ({ src, width, height, alt }));
}

/**
 * Injected into the active tab: fetches an image the way the page can (same
 * origin, CORS-enabled hosts, blob: URLs) and returns it as base64, since
 * script results must be JSON. Fails for cross-origin images without CORS,
 * which then need a host permission (see readImageBytes).
 */
export async function fetchImageInPage(src: string, maxBytes: number): Promise<{ ok: true; base64: string; type: string } | { ok: false; reason: string }> {
  try {
    const response = await fetch(src, { credentials: "same-origin" });
    if (!response.ok) return { ok: false, reason: "http" };
    const buffer = new Uint8Array(await response.arrayBuffer());
    if (buffer.length > maxBytes) return { ok: false, reason: "too_large" };
    let binary = "";
    for (let i = 0; i < buffer.length; i += 0x8000) binary += String.fromCharCode(...buffer.subarray(i, i + 0x8000));
    return { ok: true, base64: btoa(binary), type: response.headers.get("content-type") ?? "" };
  } catch {
    return { ok: false, reason: "blocked" };
  }
}

export type ImageBytes =
  | { kind: "ok"; blob: Blob }
  | { kind: "needs_permission"; origin: string }
  | { kind: "too_large" }
  | { kind: "failed" };

/** The origin pattern for a host permission request, or null for non-web URLs. */
export function originPattern(src: string): string | null {
  try {
    const url = new URL(src);
    return url.protocol === "https:" || url.protocol === "http:" ? `${url.origin}/*` : null;
  } catch {
    return null;
  }
}

function base64ToBlob(base64: string, type: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}

/**
 * Reads an image's bytes without any prompt where possible: first in the page
 * (same origin, CORS, blob:), then from the popup if the extension already
 * has a host permission for the image's origin. Otherwise reports that the
 * user needs to grant one; the popup asks only when they click to allow it.
 */
export async function readImageBytes(tabId: number, src: string): Promise<ImageBytes> {
  const [injection] = await chrome.scripting.executeScript({ target: { tabId }, func: fetchImageInPage, args: [src, MAX_READ_BYTES] });
  const inPage = injection?.result;
  if (inPage?.ok) return { kind: "ok", blob: base64ToBlob(inPage.base64, inPage.type) };
  if (inPage && !inPage.ok && inPage.reason === "too_large") return { kind: "too_large" };

  const origin = originPattern(src);
  if (!origin) return { kind: "failed" };
  if (!(await chrome.permissions.contains({ origins: [origin] }))) return { kind: "needs_permission", origin };
  return fetchWithPermission(src);
}

/** Fetches from the popup, which bypasses CORS once a host permission is granted. Never sends cookies. */
export async function fetchWithPermission(src: string, fetchImpl: typeof fetch = fetch): Promise<ImageBytes> {
  try {
    const response = await fetchImpl(src, { credentials: "omit", referrerPolicy: "no-referrer" });
    if (!response.ok) return { kind: "failed" };
    const blob = await response.blob();
    return blob.size > MAX_READ_BYTES ? { kind: "too_large" } : { kind: "ok", blob };
  } catch {
    return { kind: "failed" };
  }
}

/** The C2PA format (MIME type) for an image, from its bytes when the server's content-type is missing or wrong. */
export function sniffImageFormat(bytes: Uint8Array, declared: string): string | null {
  const b = bytes;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) {
    const brand = String.fromCharCode(b[8], b[9], b[10], b[11]);
    if (brand === "avif" || brand === "avis") return "image/avif";
    if (/^hei|^mif1|^msf1/.test(brand)) return "image/heic";
  }
  if (b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a) return "image/tiff";
  if (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0x00 && b[3] === 0x2a) return "image/tiff";
  const type = declared.split(";")[0].trim().toLowerCase();
  return type === "image/svg+xml" ? type : null;
}

/**
 * Makes the copy sent for an estimate: at most MAX_IMAGE_EDGE px on the long
 * edge, re-encoded as JPEG on white (which also drops all metadata).
 */
export async function prepareEstimateJpeg(blob: Blob): Promise<Blob | null> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    return null;
  }
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * scale)), Math.max(1, Math.round(bitmap.height * scale)));
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  for (const quality of [0.85, 0.7, 0.5]) {
    const jpeg = await canvas.convertToBlob({ type: "image/jpeg", quality });
    if (jpeg.size <= MAX_IMAGE_BYTES) return jpeg;
  }
  return null;
}

/** Sends the prepared JPEG for a Tier 2 estimate. Image bytes only, no cookies or referrer. */
export async function requestImageEstimate(apiBase: string, jpeg: Blob, fetchImpl: typeof fetch = fetch): Promise<ImageEstimateOutcome> {
  let response: Response;
  try {
    response = await fetchImpl(`${apiBase}/api/ai-check/image`, {
      method: "POST",
      headers: { "content-type": "image/jpeg" },
      body: jpeg,
      credentials: "omit",
      referrerPolicy: "no-referrer",
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return { kind: "error" };
  }
  if (response.status === 429) {
    const retryAfter = Number(response.headers.get("retry-after"));
    return { kind: "rate_limited", retryAfterSeconds: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null };
  }
  const body: unknown = await response.json().catch(() => null);
  if (response.status === 503) {
    const message = (body as { error?: unknown } | null)?.error;
    return { kind: "unavailable", message: typeof message === "string" ? message.slice(0, 200) : undefined };
  }
  if (!response.ok) return { kind: "error" };
  const parsed = parseImageEstimateResponse(body);
  return parsed ? { kind: "response", response: parsed } : { kind: "error" };
}

export { MAX_CANDIDATES };
