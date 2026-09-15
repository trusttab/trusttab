import type { ManifestInput } from "./types";

/**
 * Human-readable differences between the published manifest and a draft,
 * shown before publishing so the owner confirms concrete changes, not a vague
 * "something changed". Pure, for testing.
 */

export type DiffLine = {
  kind: "added" | "removed" | "changed" | "attestation";
  text: string;
};

const key = (e: ManifestInput["endpoints"][number]) => `${e.method} ${e.path}`;

export function diffManifestInputs(published: ManifestInput | null, draft: ManifestInput): DiffLine[] {
  const lines: DiffLine[] = [];
  const before = new Map((published?.endpoints ?? []).map((e) => [key(e), e]));
  const after = new Map(draft.endpoints.map((e) => [key(e), e]));

  for (const [k, e] of after) {
    const old = before.get(k);
    if (!old) {
      lines.push({
        kind: "added",
        text: `New endpoint ${k} (${e.purpose}) with fields: ${Object.entries(e.schema).map(([n, t]) => `${n}: ${t}`).join(", ") || "none"}`,
      });
      if (e.self_attested) {
        lines.push({ kind: "attestation", text: `You self-attest that the form at ${k} exists as declared` });
      }
      continue;
    }
    if (old.purpose !== e.purpose) lines.push({ kind: "changed", text: `${k}: purpose ${old.purpose} → ${e.purpose}` });
    for (const [n, t] of Object.entries(e.schema)) {
      if (!(n in old.schema)) lines.push({ kind: "changed", text: `${k}: added field ${n}: ${t}` });
      else if (old.schema[n] !== t) lines.push({ kind: "changed", text: `${k}: field ${n} type ${old.schema[n]} → ${t}` });
    }
    for (const n of Object.keys(old.schema)) {
      if (!(n in e.schema)) lines.push({ kind: "changed", text: `${k}: removed field ${n}` });
    }
    if (old.agent_safe !== e.agent_safe) lines.push({ kind: "changed", text: `${k}: safe for agents ${yesNo(old.agent_safe)} → ${yesNo(e.agent_safe)}` });
    if (old.requires_captcha !== e.requires_captcha) lines.push({ kind: "changed", text: `${k}: requires CAPTCHA ${yesNo(old.requires_captcha)} → ${yesNo(e.requires_captcha)}` });
    if (old.self_attested !== e.self_attested) {
      lines.push({
        kind: "attestation",
        text: e.self_attested
          ? `You self-attest that the form at ${k} exists as declared`
          : `Self-attestation removed from ${k}`,
      });
    }
  }
  for (const k of before.keys()) {
    if (!after.has(k)) lines.push({ kind: "removed", text: `Endpoint ${k} removed` });
  }

  const oldLimit = published?.agent_rate_limit;
  if (!oldLimit || oldLimit.requests_per_minute !== draft.agent_rate_limit.requests_per_minute) {
    if (oldLimit) lines.push({ kind: "changed", text: `Agent rate limit ${oldLimit.requests_per_minute} → ${draft.agent_rate_limit.requests_per_minute} requests/minute` });
  }
  if (oldLimit && oldLimit.captcha_exempt !== draft.agent_rate_limit.captcha_exempt) {
    lines.push({ kind: "changed", text: `Agents within the limit skip CAPTCHA: ${yesNo(oldLimit.captcha_exempt)} → ${yesNo(draft.agent_rate_limit.captcha_exempt)}` });
  }
  if ((published?.no_prompt_injection_pledge ?? false) !== draft.no_prompt_injection_pledge) {
    lines.push({
      kind: "attestation",
      text: draft.no_prompt_injection_pledge ? "You pledge there is no hidden content aimed at AI agents" : "No-prompt-injection pledge removed",
    });
  }
  return lines;
}

const yesNo = (b: boolean) => (b ? "yes" : "no");
