import "server-only";

import { createHash } from "node:crypto";

import { and, asc, eq } from "drizzle-orm";

import { db } from "@/db";
import { draftChanges, manifestDrafts } from "@/db/schema";
import { canonicalize } from "@/lib/manifest/canonical-json";
import { draftInputSchema, EMPTY_INPUT, manifestToInput } from "@/lib/manifest/input";
import { getLatestManifest } from "@/lib/manifest/queries";
import type { ManifestInput } from "@/lib/manifest/types";

/**
 * Saved manifest drafts. This module can read and write drafts but cannot sign
 * or publish anything: it is shared by the owner's editor and the dashboard
 * assistant, and publishing lives only in the human publish flow.
 */

export type Draft = {
  input: ManifestInput;
  version: number;
  /** Content hash of `input`; publishing must name the hash the owner reviewed. */
  hash: string;
  updatedBy: "owner" | "assistant";
  updatedAt: Date;
};

export class DraftConflictError extends Error {
  constructor(public currentVersion: number) {
    super("The draft was changed by someone else. Reload to see the latest version.");
  }
}

/** SHA-256 over the RFC 8785 canonical JSON of the input. */
export function draftHash(input: ManifestInput): string {
  return createHash("sha256").update(canonicalize(input)).digest("base64url");
}

/**
 * Returns the site's draft, creating it on first use from the latest published
 * manifest (or an empty manifest if nothing has been published yet).
 */
export async function getOrCreateDraft(siteId: string): Promise<Draft> {
  const [row] = await db.select().from(manifestDrafts).where(eq(manifestDrafts.siteId, siteId));
  if (row) return toDraft(row);

  const published = await getLatestManifest(siteId);
  const input = published ? manifestToInput(published.payloadJson) : EMPTY_INPUT;
  await db.insert(manifestDrafts).values({ siteId, inputJson: input, updatedBy: "owner" }).onConflictDoNothing();
  const [created] = await db.select().from(manifestDrafts).where(eq(manifestDrafts.siteId, siteId));
  return toDraft(created);
}

/**
 * Saves a new draft if `baseVersion` is still current (optimistic concurrency),
 * so the owner and the assistant can't silently overwrite each other. Changes
 * by the assistant are logged with their reason for pre-publish review.
 */
export async function saveDraft(args: {
  siteId: string;
  input: unknown;
  baseVersion: number;
  actor: "owner" | "assistant";
  change?: { summary: string; reason: string };
}): Promise<Draft> {
  const input = draftInputSchema.parse(args.input) as ManifestInput;

  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(manifestDrafts)
      .set({ inputJson: input, version: args.baseVersion + 1, updatedBy: args.actor, updatedAt: new Date() })
      .where(and(eq(manifestDrafts.siteId, args.siteId), eq(manifestDrafts.version, args.baseVersion)))
      .returning();
    if (!row) {
      const [current] = await tx
        .select({ version: manifestDrafts.version })
        .from(manifestDrafts)
        .where(eq(manifestDrafts.siteId, args.siteId));
      throw new DraftConflictError(current?.version ?? 0);
    }
    if (args.actor === "assistant") {
      await tx.insert(draftChanges).values({
        siteId: args.siteId,
        actor: "assistant",
        summary: args.change?.summary ?? "Edited the draft",
        reason: args.change?.reason ?? "",
        draftVersion: row.version,
      });
    }
    return toDraft(row);
  });
}

/** Assistant changes since the last publish, oldest first. */
export async function getAssistantChanges(siteId: string) {
  return db.select().from(draftChanges).where(eq(draftChanges.siteId, siteId)).orderBy(asc(draftChanges.createdAt));
}

function toDraft(row: typeof manifestDrafts.$inferSelect): Draft {
  return {
    input: row.inputJson,
    version: row.version,
    hash: draftHash(row.inputJson),
    updatedBy: row.updatedBy,
    updatedAt: row.updatedAt,
  };
}
