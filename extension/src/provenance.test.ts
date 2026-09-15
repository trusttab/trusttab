import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { Manifest } from "@contentauth/c2pa-types";

import { describeProvenance, findUnsignedAiMetadata, sourceStatements, summarizeManifest, type CredentialsResult, type ManifestSummary } from "./provenance";

const IPTC = "http://cv.iptc.org/newscodes/digitalsourcetype/";

const manifest = (actions: { action: string; digitalSourceType?: string }[]): Manifest => ({
  claim_generator_info: [{ name: "Example Image Generator" }],
  signature_info: { issuer: "Example AI Inc.", time: "2026-08-02T10:00:00+00:00" },
  assertions: [{ label: "c2pa.actions.v2", data: { actions } }],
});

const summary = (actions: { action: string; digitalSourceType?: string }[]): ManifestSummary => summarizeManifest(manifest(actions), []);

const credentials = (state: "Trusted" | "Valid" | "Invalid", s: ManifestSummary, trustList: "c2pa" | "interim" | null = state === "Trusted" ? "c2pa" : null): CredentialsResult => ({
  kind: "manifest",
  state,
  trustList,
  summary: s,
});

describe("summarizeManifest and sourceStatements", () => {
  test("extracts signer, time, generator and source types", () => {
    const s = summary([{ action: "c2pa.created", digitalSourceType: `${IPTC}trainedAlgorithmicMedia` }]);
    assert.equal(s.signer, "Example AI Inc.");
    assert.deepEqual(s.generators, ["Example Image Generator"]);
    assert.deepEqual(sourceStatements(s), ["Says it was created with generative AI"]);
  });

  test("distinguishes generative AI edits, camera captures and plain algorithmic media", () => {
    assert.deepEqual(
      sourceStatements(
        summary([
          { action: "c2pa.created", digitalSourceType: `${IPTC}digitalCapture` },
          { action: "c2pa.edited", digitalSourceType: `${IPTC}compositeWithTrainedAlgorithmicMedia` },
          { action: "c2pa.color_adjustments" },
        ]),
      ),
      ["Says it was captured with a digital camera", "Says it was edited with generative AI"],
    );
    assert.deepEqual(sourceStatements(summary([{ action: "c2pa.created", digitalSourceType: `${IPTC}algorithmicMedia` }])), [
      "Says it was created by an algorithm (not described as generative AI)",
    ]);
  });
});

describe("describeProvenance tiers", () => {
  const ai = summary([{ action: "c2pa.created", digitalSourceType: `${IPTC}trainedAlgorithmicMedia` }]);

  test("trusted credentials are verified facts about what the signer states, with no estimate offered", () => {
    const d = describeProvenance(credentials("Trusted", ai), []);
    assert.equal(d.tier, "verified");
    assert.equal(d.chip, "Verified");
    assert.deepEqual(d.statements.slice(0, 2), ["Signed by Example AI Inc. on 2026-08-02", "Says it was created with generative AI"]);
    assert.match(d.details.join(" "), /official C2PA Trust List/);
    assert.match(d.details.join(" "), /doesn't prove the statements are true/);
    assert.equal(d.allowEstimate, false);
  });

  test("the interim trust list is named as such", () => {
    assert.match(describeProvenance(credentials("Trusted", ai, "interim"), []).details[0], /interim Content Credentials trust list, which is being phased out/);
  });

  test("trusted credentials that don't mention AI say so, rather than implying no AI", () => {
    const d = describeProvenance(credentials("Trusted", summary([{ action: "c2pa.opened" }])), []);
    assert.ok(d.statements.includes("The credentials don't say whether AI was used"));
  });

  test("an unrecognized signer or invalid credentials are unverified, never presented as fact", () => {
    const untrusted = describeProvenance(credentials("Valid", ai), []);
    assert.equal(untrusted.tier, "unverified");
    assert.ok(untrusted.statements.includes("Says it was created with generative AI (unverified)"));
    assert.equal(untrusted.allowEstimate, true);

    const invalid = describeProvenance(credentials("Invalid", ai), []);
    assert.equal(invalid.tier, "unverified");
    assert.deepEqual(invalid.statements, []);
    assert.match(invalid.details[0], /doesn't mean the image is AI-generated/);
  });

  test("unsigned metadata gets the unverified tier with its own chip", () => {
    const d = describeProvenance({ kind: "none" }, [{ statement: "The file's IPTC metadata says it was created with generative AI" }]);
    assert.equal(d.tier, "unverified");
    assert.equal(d.chip, "Unsigned");
    assert.match(d.details[0], /can be added or edited by anyone/);
  });

  test("nothing found is neutral", () => {
    const d = describeProvenance({ kind: "none" }, []);
    assert.equal(d.tier, "none");
    assert.match(d.details[0], /says nothing about how the image was made/);
    assert.equal(describeProvenance({ kind: "unsupported" }, []).tier, "notice");
  });
});

describe("findUnsignedAiMetadata", () => {
  const bytes = (text: string) => new TextEncoder().encode(`\xff\xd8 junk ${text} more junk`);

  test("recognizes AI metadata markers", () => {
    const cases: [string, string][] = [
      [`<Iptc4xmpExt:DigitalSourceType>${IPTC}trainedAlgorithmicMedia</Iptc4xmpExt:DigitalSourceType>`, "iptc-generative-ai"],
      [`Iptc4xmpExt:DigitalSourceType="${IPTC}compositeWithTrainedAlgorithmicMedia"`, "iptc-generative-ai"],
      ["parameters\0a cat in a hat\nNegative prompt: blurry\nSteps: 20, Sampler: Euler a, CFG scale: 7", "sd-webui-parameters"],
      ['prompt\0{"3": {"inputs": {"seed": 1}, "class_type": "KSampler"}}', "comfyui-workflow"],
      ['xmp:CreatorTool="Midjourney"', "ai-creator-tool"],
    ];
    for (const [text, id] of cases) assert.deepEqual(findUnsignedAiMetadata(bytes(text)).map((m) => m.id), [id], id);
  });

  test("ordinary camera and editor metadata doesn't match", () => {
    for (const text of [
      `<Iptc4xmpExt:DigitalSourceType>${IPTC}digitalCapture</Iptc4xmpExt:DigitalSourceType>`,
      'xmp:CreatorTool="Adobe Photoshop 26.0"',
      "Software\0GIMP 2.10",
      "parameters\0 exposure 1/200",
      "An article about Midjourney and Stable Diffusion",
    ]) {
      assert.deepEqual(findUnsignedAiMetadata(bytes(text)), [], text);
    }
  });
});
