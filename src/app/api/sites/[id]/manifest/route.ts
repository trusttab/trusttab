import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/db";
import { sites } from "@/db/schema";
import { getApiUser, isUniqueViolation, isUuid, jsonError } from "@/lib/api";
import { buildManifest, generateVerificationId } from "@/lib/manifest/build";
import { signManifest } from "@/lib/manifest/signing";
import { insertManifestVersion } from "@/lib/manifest/store";
import type { ManifestInput } from "@/lib/manifest/types";
import { validateManifest } from "@/lib/manifest/validate";

const MAX_BODY_BYTES = 200_000;

/**
 * POST /api/sites/:id/manifest — publish a new manifest version.
 *
 * Body (ManifestInput):
 *   {
 *     "no_prompt_injection_pledge": true,
 *     "agent_rate_limit": { "requests_per_minute": 30, "captcha_exempt": false },
 *     "endpoints": [{ "path": "/contact", "method": "POST", "purpose": "lead_inquiry",
 *                     "schema": { "email": "email", "message": "string" },
 *                     "agent_safe": true, "requires_captcha": false }]
 *   }
 *
 * TrustTab fills in issuer, domain, timestamps and scan status, signs the
 * result, validates the *signed* document against agent-trust.schema.json,
 * and stores it as the site's next version (resetting the site's status to
 * "pending" until it is re-verified). Responds 201 with the manifest,
 * or 422 with `{ error, details: [{ path, message }] }`.
 *
 * Requires domain ownership to be verified first.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/sites/[id]/manifest">) {
  const user = await getApiUser();
  if (!user) return jsonError(401, "Sign in first.");

  const { id } = await ctx.params;
  if (!isUuid(id)) return jsonError(404, "Site not found.");

  const [site] = await db
    .select()
    .from(sites)
    .where(and(eq(sites.id, id), eq(sites.userId, user.id)));
  if (!site) return jsonError(404, "Site not found.");
  if (!site.ownershipVerifiedAt) {
    return jsonError(403, "Verify ownership of this domain before publishing a manifest.");
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return jsonError(413, "Manifest is too large.");
  let input: ManifestInput;
  try {
    input = JSON.parse(raw);
  } catch {
    return jsonError(400, "Expected a JSON body.");
  }
  if (!input || typeof input !== "object" || !Array.isArray(input.endpoints) || !input.agent_rate_limit) {
    return jsonError(400, "Body must include endpoints and agent_rate_limit.");
  }

  // Assign the site's public registry ID on first publish. The conditional
  // update makes concurrent first publishes agree on a single ID.
  let verificationId = site.verificationId;
  if (!verificationId) {
    await db
      .update(sites)
      .set({ verificationId: generateVerificationId() })
      .where(and(eq(sites.id, site.id), isNull(sites.verificationId)));
    [{ verificationId }] = await db
      .select({ verificationId: sites.verificationId })
      .from(sites)
      .where(eq(sites.id, site.id));
  }

  let manifest;
  try {
    manifest = signManifest(
      buildManifest({ domain: site.domain, verificationId: verificationId!, input }),
    );
  } catch (err) {
    // buildManifest reads nested input fields; malformed shapes land here.
    if (err instanceof TypeError) return jsonError(400, "Malformed manifest input.");
    throw err;
  }

  const details = validateManifest(manifest);
  if (details.length > 0) {
    return NextResponse.json({ error: "Manifest is invalid.", details }, { status: 422 });
  }

  try {
    const saved = await db.transaction(async (tx) => {
      const row = await insertManifestVersion(tx, site.id, manifest);
      // New declarations haven't been checked, so the site is no longer verified.
      await tx.update(sites).set({ status: "pending" }).where(eq(sites.id, site.id));
      return row;
    });

    return NextResponse.json({ version: saved.version, manifest }, { status: 201 });
  } catch (err) {
    // Two publishes raced for the same version number.
    if (isUniqueViolation(err)) return jsonError(409, "Another publish just happened. Please retry.");
    throw err;
  }
}
