import "server-only";

import Ajv2020, { type ErrorObject } from "ajv/dist/2020";
import addFormats from "ajv-formats";

import schema from "../../../agent-trust.schema.json";
import type { Manifest } from "./types";

// Compiled once per server instance. `strict` makes Ajv reject schema typos
// (unknown keywords) instead of silently ignoring them.
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validateSchema = ajv.compile<Manifest>(schema);

export type ValidationError = { path: string; message: string };

/**
 * Validates a complete manifest against agent-trust.schema.json, plus the
 * rules JSON Schema can't express. Returns an empty array if valid.
 */
export function validateManifest(manifest: unknown): ValidationError[] {
  if (!validateSchema(manifest)) {
    return (validateSchema.errors ?? []).map(formatAjvError);
  }

  const errors: ValidationError[] = [];
  const seen = new Set<string>();
  manifest.endpoints.forEach((endpoint, i) => {
    const key = `${endpoint.method} ${endpoint.path}`;
    if (seen.has(key)) {
      errors.push({ path: `/endpoints/${i}`, message: `duplicate endpoint ${key}` });
    }
    seen.add(key);
  });
  return errors;
}

function formatAjvError(error: ErrorObject): ValidationError {
  const path = error.instancePath || "/";
  switch (error.keyword) {
    case "additionalProperties":
      return { path, message: `unknown field "${error.params.additionalProperty}"` };
    case "const":
      return path === "/policy/no_prompt_injection_pledge"
        ? { path, message: "must be accepted to publish a manifest" }
        : { path, message: `must be ${JSON.stringify(error.params.allowedValue)}` };
    case "enum":
      return { path, message: `must be one of: ${(error.params.allowedValues as string[]).join(", ")}` };
    case "pattern":
      return { path, message: path.includes("/schema/") ? "is not a valid field type (see the type reference)" : "has an invalid format" };
    default:
      return { path, message: error.message ?? "is invalid" };
  }
}
