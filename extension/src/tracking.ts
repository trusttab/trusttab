import type { PageEvidence } from "./widgets";
import { TRACKING_SIGNATURES, type TrackingKind, type TrackingSignature } from "./tracking-signatures";

/**
 * Matches the page's loaded hosts against the tracking signature list.
 *
 * Reuses the evidence the widget check already collects — the same script,
 * iframe and resource-timing hosts — so this adds no second injection and no
 * new page access.
 */

export type TrackingDetection = {
  id: string;
  name: string;
  vendor: string;
  kind: TrackingKind;
  note?: string;
  /** The host that matched, shown so the finding is checkable. */
  evidence: string[];
};

const matchesHost = (host: string, known: string) => host === known || host.endsWith(`.${known}`);

export function detectTracking(evidence: PageEvidence, signatures: TrackingSignature[] = TRACKING_SIGNATURES): TrackingDetection[] {
  const hosts = evidence.hosts.map((h) => h.toLowerCase());
  const detections: TrackingDetection[] = [];

  for (const signature of signatures) {
    const matched = signature.hosts.filter((known) => hosts.some((host) => matchesHost(host, known)));
    if (matched.length === 0) continue;
    detections.push({
      id: signature.id,
      name: signature.name,
      vendor: signature.vendor,
      kind: signature.kind,
      note: signature.note,
      evidence: matched.map((host) => `loads from ${host}`),
    });
  }
  return detections;
}

const KIND_LABEL: Record<TrackingKind, string> = {
  analytics: "analytics",
  session_recording: "session recording",
  fingerprinting: "device fingerprinting",
  tag_manager: "tag manager",
};

/** One plain sentence naming what was found. Fact only, no characterisation. */
export function describeTracking(detections: TrackingDetection[]): string | null {
  if (detections.length === 0) return null;
  const names = detections.map((d) => d.name);
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `This page loads tracking from: ${list}.`;
}

export { KIND_LABEL as trackingKindLabel };
