/**
 * Web worker that reads and validates an image's Content Credentials (C2PA)
 * with the official c2pa-rs WebAssembly build. It runs inside the extension,
 * so the image never leaves the browser. It's a worker because the reader
 * needs FileReaderSync. It is loaded from the extension's own files (MV3 CSP
 * allows `'self'` workers and `'wasm-unsafe-eval'`), not the blob: worker
 * c2pa-web creates, which that CSP blocks.
 *
 * Validation runs against the official C2PA Trust List first. If the signer
 * isn't on it, the interim Content Credentials list is tried, and a match is
 * reported as such.
 */
import init, { WasmReader } from "@contentauth/c2pa-wasm";
import { createTrustSettings, createVerifySettings, mergeSettings, settingsToJson } from "@contentauth/c2pa-utilities";
import type { Reader, ValidationState } from "@contentauth/c2pa-types";

import { summarizeManifest, type CredentialsResult } from "./provenance";

export type WorkerRequest = {
  blob: Blob;
  format: string;
  trust: { c2pa: string; interimAnchors: string; interimAllowed: string; interimConfig: string };
};

let ready: Promise<unknown> | undefined;

async function read(blob: Blob, format: string, settings: string) {
  const reader = await WasmReader.fromBlob(format, blob, settings);
  try {
    const store = reader.manifestStore() as Reader;
    const failures = (store.validation_results?.activeManifest?.failure ?? []).map((f) => f.code);
    return { state: (store.validation_state ?? "Invalid") as ValidationState, manifest: reader.activeManifest(), failures };
  } finally {
    reader.free();
  }
}

self.onmessage = async ({ data }: MessageEvent<WorkerRequest>) => {
  let result: CredentialsResult;
  try {
    ready ??= init({ module_or_path: new URL("c2pa_bg.wasm", self.location.href) });
    await ready;
    const verify = createVerifySettings({ verifyTrust: true });
    const official = settingsToJson(mergeSettings(createTrustSettings({ trustAnchors: data.trust.c2pa }), verify));
    let { state, manifest, failures } = await read(data.blob, data.format, official);
    let trustList: "c2pa" | "interim" | null = state === "Trusted" ? "c2pa" : null;

    if (state === "Valid") {
      const interim = settingsToJson(
        mergeSettings(
          createTrustSettings({
            trustAnchors: data.trust.interimAnchors,
            allowedList: data.trust.interimAllowed,
            trustConfig: data.trust.interimConfig,
          }),
          verify,
        ),
      );
      const second = await read(data.blob, data.format, interim);
      if (second.state === "Trusted") ({ state, manifest, failures, trustList } = { ...second, trustList: "interim" });
    }
    result = { kind: "manifest", state, trustList, summary: summarizeManifest(manifest, failures) };
  } catch (err) {
    const message = String((err as Error)?.message ?? err);
    if (/JumbfNotFound|ProvenanceMissing|ClaimMissing/i.test(message)) result = { kind: "none" };
    else if (/UnsupportedType|NotSupported|unsupported/i.test(message)) result = { kind: "unsupported" };
    else result = { kind: "error" };
  }
  self.postMessage(result);
};
