/**
 * AI Check 2c, Tier 2: the vision-model estimate for images with no verified
 * Content Credentials. The parts shared by the server route and the browser
 * extension (limits, response parsing, wording). Browser-safe and pure.
 *
 * Rules (EXTENSION_SPEC.md, owner decisions 2026-09-15):
 * - Every label says it is an estimate and that no verified metadata was
 *   found, and it reads visibly weaker than a Tier 1 (verified metadata) result.
 * - Only two outcomes, and never "real" or "authentic": vouching for an AI
 *   image is a harm too.
 * - "Possibly AI-generated" needs at least one concrete visual artifact from
 *   VISUAL_ARTIFACTS, enforced in code (see applyArtifactRule). Wrongly calling
 *   a real photo or a person's artwork AI-generated harms real people.
 */

export const IMAGE_ASSESSMENTS = ["possibly_ai", "no_clear_signs"] as const;
export type ImageAssessment = (typeof IMAGE_ASSESSMENTS)[number];

/**
 * The only visual signs that can support "Possibly AI-generated". Concrete
 * things a person can look for in the image themselves, never overall style
 * ("too smooth", "unusual lighting"). This is the only place they are defined.
 */
export const VISUAL_ARTIFACTS = {
  garbled_text: "Garbled or nonsense text",
  malformed_anatomy: "Malformed hands, fingers, teeth or other anatomy",
  impossible_geometry: "Impossible geometry, or objects merging into each other",
  inconsistent_reflection_or_shadow: "A reflection or shadow that doesn't match the scene",
  generator_watermark: "A visible AI generator watermark or \"AI-generated\" label",
} as const;
export type VisualArtifact = keyof typeof VISUAL_ARTIFACTS;
export const VISUAL_ARTIFACT_TYPES = Object.keys(VISUAL_ARTIFACTS) as VisualArtifact[];

/** Longest edge of the copy sent for an estimate, in pixels. */
export const MAX_IMAGE_EDGE = 1024;
/** Largest request body the estimate endpoint accepts. */
export const MAX_IMAGE_BYTES = 1_500_000;
export const MAX_ARTIFACTS = 3;
export const MAX_ARTIFACT_WHERE_CHARS = 80;

export type ReportedArtifact = { type: VisualArtifact; where: string };

/** Body of a successful `POST /api/ai-check/image` response. */
export type ImageEstimateResponse = { result: "estimate"; assessment: ImageAssessment; artifacts: ReportedArtifact[] };

export function parseArtifacts(value: unknown): ReportedArtifact[] {
  if (!Array.isArray(value)) return [];
  const artifacts: ReportedArtifact[] = [];
  for (const item of value) {
    const { type, where } = (item ?? {}) as { type?: unknown; where?: unknown };
    if (typeof type !== "string" || !VISUAL_ARTIFACT_TYPES.includes(type as VisualArtifact)) continue;
    artifacts.push({
      type: type as VisualArtifact,
      where: typeof where === "string" ? where.replace(/\s+/g, " ").trim().slice(0, MAX_ARTIFACT_WHERE_CHARS) : "",
    });
    if (artifacts.length === MAX_ARTIFACTS) break;
  }
  return artifacts;
}

/**
 * The bias rule, in shared code so the server enforces it and the extension
 * re-applies it to whatever it receives: "possibly_ai" stands only with at
 * least one concrete artifact from the fixed list. Otherwise it is
 * "no_clear_signs", and artifacts are never attached to that outcome.
 */
export function applyArtifactRule(assessment: ImageAssessment, artifacts: ReportedArtifact[]): ImageEstimateResponse {
  if (assessment === "possibly_ai" && artifacts.length > 0) return { result: "estimate", assessment, artifacts };
  return { result: "estimate", assessment: "no_clear_signs", artifacts: [] };
}

export function parseImageEstimateResponse(body: unknown): ImageEstimateResponse | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  if (b.result !== "estimate" || !IMAGE_ASSESSMENTS.includes(b.assessment as ImageAssessment)) return null;
  return applyArtifactRule(b.assessment as ImageAssessment, parseArtifacts(b.artifacts));
}

export const IMAGE_ESTIMATE_LABELS: Record<ImageAssessment, string> = {
  possibly_ai: "Possibly AI-generated (estimate, no verified metadata found)",
  no_clear_signs: "No clear signs of AI generation (estimate, no verified metadata found)",
};

export const IMAGE_ESTIMATE_CAVEAT =
  "AI-image detection is often wrong. Don't use this to judge or accuse anyone, or as proof that an image is real.";

export type ImageEstimateOutcome =
  | { kind: "response"; response: ImageEstimateResponse }
  | { kind: "rate_limited"; retryAfterSeconds: number | null }
  | { kind: "unavailable"; message?: string }
  | { kind: "unreadable" }
  | { kind: "error" };

export type ImageEstimateDisplay = {
  tone: "estimate" | "notice";
  title: string;
  /** For possibly_ai: the artifacts the model reports, for the viewer to look for. */
  artifacts: string[];
  details: string[];
};

function waitPhrase(seconds: number | null): string {
  if (!seconds) return "later";
  if (seconds < 90) return "in a minute";
  if (seconds < 90 * 60) return `in about ${Math.round(seconds / 60)} minutes`;
  return `in about ${Math.round(seconds / 3600)} hours`;
}

export function describeImageEstimate(outcome: ImageEstimateOutcome): ImageEstimateDisplay {
  switch (outcome.kind) {
    case "response": {
      const { assessment, artifacts } = outcome.response;
      return {
        tone: "estimate",
        title: IMAGE_ESTIMATE_LABELS[assessment],
        artifacts: artifacts.map((a) => (a.where ? `${VISUAL_ARTIFACTS[a.type]}: ${a.where}` : VISUAL_ARTIFACTS[a.type])),
        details: [
          assessment === "possibly_ai"
            ? "Look for these in the image yourself; the model can be wrong about them."
            : "No specific sign of AI generation was found. That doesn't show the image is real.",
          IMAGE_ESTIMATE_CAVEAT,
        ],
      };
    }
    case "rate_limited":
      return {
        tone: "notice",
        title: "Check limit reached",
        artifacts: [],
        details: [`Image checks are limited to keep the service free. Try again ${waitPhrase(outcome.retryAfterSeconds)}.`],
      };
    case "unavailable":
      return { tone: "notice", title: "Image estimate unavailable", artifacts: [], details: [outcome.message ?? "This TrustTab instance can't run image estimates right now."] };
    case "unreadable":
      return { tone: "notice", title: "Can't read this image", artifacts: [], details: ["This image format can't be prepared for an estimate. Nothing was sent."] };
    case "error":
      return { tone: "notice", title: "Image estimate failed", artifacts: [], details: ["Couldn't get an estimate. Please try again."] };
  }
}
