import { z } from "zod";

import { METHODS, PURPOSES, type Manifest, type ManifestInput } from "./types";

/**
 * The owner-editable part of a manifest ("input"): what the editor, the saved
 * draft and the dashboard assistant work with. Everything else in a manifest
 * (issuer, domain, timestamps, signature, verification state) is set by
 * TrustTab when a human publishes.
 */

/** A new site's starting point: no endpoints, pledge not yet given. */
export const EMPTY_INPUT: ManifestInput = {
  no_prompt_injection_pledge: false,
  agent_rate_limit: { requests_per_minute: 30, captcha_exempt: false },
  endpoints: [],
};

/** Extracts the owner-editable parts of a published manifest. */
export function manifestToInput(manifest: Manifest): ManifestInput {
  return {
    no_prompt_injection_pledge: manifest.policy.no_prompt_injection_pledge,
    agent_rate_limit: { ...manifest.policy.agent_rate_limit },
    endpoints: manifest.endpoints.map((e) => ({
      path: e.path,
      method: e.method,
      purpose: e.purpose,
      schema: { ...e.schema },
      agent_safe: e.agent_safe,
      requires_captcha: e.requires_captcha,
      // Manifests signed before self-attestation existed lack the field.
      self_attested: e.self_attested ?? false,
    })),
  };
}

/**
 * Structural validation for drafts. Deliberately looser than the manifest
 * schema (a draft may be mid-edit: empty endpoints, pledge unchecked, a path
 * being typed); the full agent-trust.schema.json check runs at publish.
 */
export const draftInputSchema = z
  .object({
    no_prompt_injection_pledge: z.boolean(),
    agent_rate_limit: z
      .object({
        requests_per_minute: z.number().int().min(0).max(100_000),
        captcha_exempt: z.boolean(),
      })
      .strict(),
    endpoints: z
      .array(
        z
          .object({
            path: z.string().max(2000),
            method: z.enum(METHODS),
            purpose: z.enum(PURPOSES as unknown as [string, ...string[]]),
            schema: z.record(z.string().max(100), z.string().max(500)).refine((s) => Object.keys(s).length <= 100, {
              message: "at most 100 fields",
            }),
            agent_safe: z.boolean(),
            requires_captcha: z.boolean(),
            self_attested: z.boolean(),
          })
          .strict(),
      )
      .max(50),
  })
  .strict();
