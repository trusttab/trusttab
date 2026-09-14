import schema from "../../../agent-trust.schema.json";

/**
 * TypeScript mirror of agent-trust.schema.json. The JSON Schema is the source
 * of truth; these types exist for editor support and must be kept in sync.
 */

/** Allowed endpoint purposes, read straight from the schema so the UI can't drift from it. */
export const PURPOSES = schema.$defs.purpose.enum as readonly Purpose[];

export type Purpose =
  | "lead_inquiry"
  | "booking"
  | "support_ticket"
  | "quote_request"
  | "waitlist_signup"
  | "document_upload"
  | "cancellation"
  | "account_lookup";

export const METHODS = ["GET", "POST"] as const;
export type Method = (typeof METHODS)[number];

export type ManifestEndpoint = {
  path: string;
  method: Method;
  purpose: Purpose;
  /** input name → field type expression, e.g. `{ "email": "email", "notes": "string?" }` */
  schema: Record<string, string>;
  agent_safe: boolean;
  requires_captcha: boolean;
};

export type Manifest = {
  version: "1.0";
  issuer: { name: string; url: string; verification_id: string };
  site: { domain: string; verified_at: string | null; expires_at: string; signature: string };
  policy: {
    no_prompt_injection_pledge: true;
    agent_rate_limit: { requests_per_minute: number; captcha_exempt: boolean };
    content_scan: { last_scanned: string | null; status: "pending" | "passed" | "failed" };
  };
  endpoints: ManifestEndpoint[];
};

export type UnsignedManifest = Omit<Manifest, "site"> & { site: Omit<Manifest["site"], "signature"> };

/** What the site owner edits in the dashboard; everything else is filled in by TrustTab. */
export type ManifestInput = {
  agent_rate_limit: Manifest["policy"]["agent_rate_limit"];
  no_prompt_injection_pledge: boolean;
  endpoints: ManifestEndpoint[];
};
