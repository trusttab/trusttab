import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { and, eq, gt, isNull, lt, or, isNotNull } from "drizzle-orm";

import { db } from "@/db";
import { publishConfirmations } from "@/db/schema";

export { sameOriginBrowserRequestError } from "./same-origin";

/**
 * The human-only publish flow.
 *
 * A manifest is a signed attestation by the site owner, so publishing must
 * never be something the dashboard assistant can do. Guarantees, from
 * strongest to defense-in-depth:
 *
 * 1. Capability: the assistant (src/lib/assistant) has no tool that publishes,
 *    cannot import this module, the signing module or the manifest store
 *    (enforced by ESLint and by src/lib/assistant/capabilities.test.ts), makes
 *    no HTTP requests to TrustTab's API, and never holds a user's session.
 * 2. Exactness: publishing signs the *stored draft*, and only if its content
 *    hash equals the hash the owner reviewed. A draft changed after review
 *    (e.g. by the assistant) can't be published until reviewed again.
 * 3. Single use: the browser first obtains a confirmation bound to the user,
 *    their current session, the site and that draft hash, valid for two
 *    minutes and consumable once.
 * 4. Browser origin: both steps require a same-origin browser request
 *    (Origin + Sec-Fetch-Site). This blocks cross-site and off-site scripted
 *    requests; it is defense in depth, not proof of a human.
 *
 * What this does not prove is that a human hand clicked: anything running
 * inside the owner's own signed-in browser could repeat the two calls. The
 * stronger, optional upgrade is a WebAuthn user-presence check at publish.
 */

const CONFIRMATION_TTL_MS = 2 * 60 * 1000;

const hashToken = (token: string) => createHash("sha256").update(token).digest("base64url");

/** Issues a single-use confirmation for publishing one exact draft. */
export async function issuePublishConfirmation(args: {
  userId: string;
  sessionId: string;
  siteId: string;
  draftHash: string;
}): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + CONFIRMATION_TTL_MS);
  // Housekeeping: drop this site's used or expired confirmations.
  await db
    .delete(publishConfirmations)
    .where(
      and(
        eq(publishConfirmations.siteId, args.siteId),
        or(isNotNull(publishConfirmations.usedAt), lt(publishConfirmations.expiresAt, new Date())),
      ),
    );
  await db.insert(publishConfirmations).values({ tokenHash: hashToken(token), ...args, expiresAt });
  return { token, expiresAt };
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Atomically marks a confirmation used if it matches every binding and hasn't
 * expired or been used. Returns false otherwise. Call inside the publish
 * transaction so a failed publish doesn't burn the confirmation.
 */
export async function consumePublishConfirmation(
  tx: Tx,
  args: { token: string; userId: string; sessionId: string; siteId: string; draftHash: string },
): Promise<boolean> {
  const rows = await tx
    .update(publishConfirmations)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(publishConfirmations.tokenHash, hashToken(args.token)),
        eq(publishConfirmations.userId, args.userId),
        eq(publishConfirmations.sessionId, args.sessionId),
        eq(publishConfirmations.siteId, args.siteId),
        eq(publishConfirmations.draftHash, args.draftHash),
        isNull(publishConfirmations.usedAt),
        gt(publishConfirmations.expiresAt, new Date()),
      ),
    )
    .returning({ tokenHash: publishConfirmations.tokenHash });
  return rows.length === 1;
}
