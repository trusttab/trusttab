/**
 * AI Check 2c, Tier 1 and the unsigned-metadata tier: what an image file
 * itself says about how it was made, read entirely in the browser. Pure
 * functions (no Chrome or WebAssembly APIs), so the wording is unit tested.
 *
 * Three confidence levels, each with its own look in the popup:
 * - "verified": Content Credentials (C2PA) whose signer chains to a trust list.
 *   Stated as fact: who signed, and what they state. A signature proves
 *   who made the statements and that the file hasn't changed since, not that
 *   the statements are true, and the wording says so.
 * - "unverified": signed credentials from an unrecognized signer, credentials
 *   that failed validation, or unsigned metadata (IPTC/XMP, generator tags)
 *   that anyone can edit. Reported as what the file says, clearly unverified.
 * - "none": nothing found, which is common and means nothing either way.
 */

import type { Manifest } from "@contentauth/c2pa-types";

// ---------------------------------------------------------------------------
// Content Credentials (C2PA)

/** Which trust list a verified signer chained to. */
export type TrustList = "c2pa" | "interim";

export type ManifestSummary = {
  signer: string | null;
  signedAt: string | null;
  generators: string[];
  actions: { action: string; digitalSourceType: string | null }[];
  failures: string[];
};

/** What the C2PA worker reports for one image. */
export type CredentialsResult =
  | { kind: "manifest"; state: "Trusted" | "Valid" | "Invalid"; trustList: TrustList | null; summary: ManifestSummary }
  | { kind: "none" }
  | { kind: "unsupported" }
  | { kind: "error" };

/** Extracts the fields the popup shows from a c2pa-rs active manifest. */
export function summarizeManifest(manifest: Manifest | null | undefined, failures: string[]): ManifestSummary {
  const actions: ManifestSummary["actions"] = [];
  for (const assertion of manifest?.assertions ?? []) {
    if (!/^c2pa\.actions(\.v\d+)?$/.test(assertion.label)) continue;
    const list = (assertion.data as { actions?: unknown } | null)?.actions;
    if (!Array.isArray(list)) continue;
    for (const item of list as { action?: unknown; digitalSourceType?: unknown }[]) {
      if (typeof item?.action !== "string") continue;
      actions.push({ action: item.action, digitalSourceType: typeof item.digitalSourceType === "string" ? item.digitalSourceType : null });
    }
  }
  const generators = (manifest?.claim_generator_info ?? [])
    .map((g) => (typeof g?.name === "string" ? g.name.trim() : ""))
    .filter(Boolean);
  if (generators.length === 0 && typeof manifest?.claim_generator === "string") generators.push(manifest.claim_generator);
  const info = manifest?.signature_info;
  return {
    signer: (info?.issuer ?? info?.common_name ?? null) || null,
    signedAt: info?.time ?? null,
    generators: generators.slice(0, 3).map((g) => g.slice(0, 80)),
    actions: actions.slice(0, 20),
    failures: failures.slice(0, 10),
  };
}

/**
 * IPTC digital source types (https://cv.iptc.org/newscodes/digitalsourcetype/)
 * that C2PA and XMP use to say how media was made, in plain words. Codes not
 * listed are shown by name. `ai: true` marks the generative-AI ones.
 */
export const DIGITAL_SOURCE_TYPES: Record<string, { phrase: string; ai: boolean }> = {
  trainedAlgorithmicMedia: { phrase: "created with generative AI", ai: true },
  compositeWithTrainedAlgorithmicMedia: { phrase: "combines generative AI with other content", ai: true },
  algorithmicallyEnhanced: { phrase: "enhanced by software", ai: false },
  algorithmicMedia: { phrase: "created by an algorithm (not described as generative AI)", ai: false },
  digitalCapture: { phrase: "captured with a digital camera", ai: false },
  computationalCapture: { phrase: "captured with a camera using computational processing", ai: false },
  negativeFilm: { phrase: "scanned from film", ai: false },
  positiveFilm: { phrase: "scanned from film", ai: false },
  print: { phrase: "scanned from a print", ai: false },
  humanEdits: { phrase: "edited by a person", ai: false },
  minorHumanEdits: { phrase: "lightly edited by a person", ai: false },
  compositeCapture: { phrase: "combines several captures", ai: false },
  composite: { phrase: "combines several elements", ai: false },
  compositeSynthetic: { phrase: "combines captured and synthetic elements", ai: false },
  digitalCreation: { phrase: "digital art made by a person using software", ai: false },
  dataDrivenMedia: { phrase: "generated from data", ai: false },
  screenCapture: { phrase: "a screenshot", ai: false },
  virtualRecording: { phrase: "a recording of a virtual scene", ai: false },
};

function sourceTypeCode(uri: string): string {
  return uri.replace(/\/+$/, "").split("/").pop() ?? uri;
}

function describeSourceType(uri: string): { phrase: string; ai: boolean } {
  const code = sourceTypeCode(uri);
  return DIGITAL_SOURCE_TYPES[code] ?? { phrase: `described as "${code.slice(0, 60)}"`, ai: false };
}

/** Plain statements of how the credentials say the image was made. */
export function sourceStatements(summary: ManifestSummary): string[] {
  const statements: string[] = [];
  for (const { action, digitalSourceType } of summary.actions) {
    if (!digitalSourceType) continue;
    const { phrase, ai } = describeSourceType(digitalSourceType);
    let statement: string;
    if (action === "c2pa.created") statement = `Says it was ${phrase}`;
    else if (ai) statement = "Says it was edited with generative AI";
    else statement = `Says it was ${phrase}`;
    if (!statements.includes(statement)) statements.push(statement);
  }
  return statements;
}

// ---------------------------------------------------------------------------
// Unsigned metadata

/**
 * Unsigned metadata that says an image was made with AI. Anyone can add,
 * remove or edit these, so a match is only ever shown as unverified. This is
 * the only place they are defined; append entries to extend. Each pattern is
 * matched against the file's bytes decoded as Latin-1 (the first few MB).
 */
export const UNSIGNED_AI_MARKERS: { id: string; statement: string; pattern: RegExp }[] = [
  {
    id: "iptc-generative-ai",
    statement: "The file's IPTC metadata says it was created with generative AI",
    pattern: /DigitalSourceType\s*(?:=\s*["']|>)\s*(?:https?:\/\/cv\.iptc\.org\/newscodes\/digitalsourcetype\/)?(?:trainedAlgorithmicMedia|compositeWithTrainedAlgorithmicMedia)\b/,
  },
  {
    id: "sd-webui-parameters",
    statement: "The file contains Stable Diffusion generation settings",
    pattern: /parameters\0[^\0]{0,4000}?\bSteps: \d+, Sampler: /,
  },
  {
    id: "comfyui-workflow",
    statement: "The file contains a ComfyUI image-generation workflow",
    pattern: /(?:prompt|workflow)\0\s*\{[^\0]{0,2000}?"class_type"/,
  },
  {
    id: "ai-creator-tool",
    statement: "The file's metadata names an AI image generator as the creating tool",
    pattern: /(?:CreatorTool|Software)(?:\s*=\s*["']|>|\0)\s*(?:Midjourney|DALL[·\-.]?E|Stable Diffusion|Adobe Firefly|Imagen|Ideogram|Leonardo\.Ai|NovelAI|Flux)\b/i,
  },
];

const SCAN_BYTES = 4 * 1024 * 1024;

export function findUnsignedAiMetadata(bytes: Uint8Array): { id: string; statement: string }[] {
  const text = new TextDecoder("latin1").decode(bytes.subarray(0, SCAN_BYTES));
  return UNSIGNED_AI_MARKERS.filter(({ pattern }) => pattern.test(text)).map(({ id, statement }) => ({ id, statement }));
}

// ---------------------------------------------------------------------------
// Wording

export type ProvenanceTier = "verified" | "unverified" | "none" | "notice";

export type ProvenanceDisplay = {
  tier: ProvenanceTier;
  /** Short badge text matching the tier's look. */
  chip: string;
  title: string;
  statements: string[];
  details: string[];
  /** Tier 2 is offered only when there are no verified credentials. */
  allowEstimate: boolean;
};

const SIGNATURE_MEANING = "The signature proves who made these statements and that the file hasn't changed since. It doesn't prove the statements are true.";

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

export function describeProvenance(credentials: CredentialsResult, unsigned: { statement: string }[]): ProvenanceDisplay {
  const unsignedStatements = unsigned.map((u) => u.statement);
  const unsignedDetail = "Metadata that isn't signed can be added or edited by anyone.";

  if (credentials.kind === "manifest" && credentials.state === "Trusted") {
    const { summary, trustList } = credentials;
    const signedAt = formatDate(summary.signedAt);
    const sources = sourceStatements(summary);
    return {
      tier: "verified",
      chip: "Verified",
      title: "Content Credentials verified",
      statements: [
        `Signed by ${summary.signer ?? "an unnamed signer"}${signedAt ? ` on ${signedAt}` : ""}`,
        ...(sources.length ? sources : ["The credentials don't say whether AI was used"]),
        ...(summary.generators.length ? [`Made with: ${summary.generators.join(", ")}`] : []),
      ],
      details: [
        trustList === "interim"
          ? "The signer is on the interim Content Credentials trust list, which is being phased out in favor of the official C2PA Trust List."
          : "The signer is on the official C2PA Trust List.",
        SIGNATURE_MEANING,
      ],
      allowEstimate: false,
    };
  }

  if (credentials.kind === "manifest" && credentials.state === "Valid") {
    const sources = sourceStatements(credentials.summary);
    return {
      tier: "unverified",
      chip: "Not verified",
      title: "Content Credentials from an unrecognized signer",
      statements: [
        `Signed by ${credentials.summary.signer ?? "an unnamed signer"} (not on a trust list TrustTab uses)`,
        ...sources.map((s) => `${s} (unverified)`),
        ...unsignedStatements,
      ],
      details: ["The file is signed, but the signer can't be verified, so these claims aren't confirmed.", ...(unsigned.length ? [unsignedDetail] : [])],
      allowEstimate: true,
    };
  }

  if (credentials.kind === "manifest" && credentials.state === "Invalid") {
    return {
      tier: "unverified",
      chip: "Not verified",
      title: "Content Credentials found, but invalid",
      statements: unsignedStatements,
      details: [
        "The file changed after it was signed, or the credentials are damaged, so they can't be relied on. This doesn't mean the image is AI-generated.",
        ...(unsigned.length ? [unsignedDetail] : []),
      ],
      allowEstimate: true,
    };
  }

  if (unsigned.length > 0) {
    return {
      tier: "unverified",
      chip: "Unsigned",
      title: "Unsigned metadata mentions AI",
      statements: unsignedStatements,
      details: [unsignedDetail, "No Content Credentials were found."],
      allowEstimate: true,
    };
  }

  if (credentials.kind === "none") {
    return {
      tier: "none",
      chip: "None found",
      title: "No Content Credentials found",
      statements: [],
      details: ["Most images lose their metadata when they're resized or uploaded, so this is common and says nothing about how the image was made."],
      allowEstimate: true,
    };
  }

  return {
    tier: "notice",
    chip: "Not checked",
    title: credentials.kind === "unsupported" ? "Can't read metadata in this image format" : "Couldn't read this image's metadata",
    statements: [],
    details: ["This says nothing about how the image was made."],
    allowEstimate: true,
  };
}
