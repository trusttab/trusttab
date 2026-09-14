import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/db";
import { sites } from "@/db/schema";
import { getApiUser, isUniqueViolation, jsonError } from "@/lib/api";
import { normalizeDomain } from "@/lib/domain";
import { generateVerificationToken } from "@/lib/ownership";

const bodySchema = z.object({ domain: z.string() });

/**
 * POST /api/sites — claim a domain.
 *
 * Body: `{ "domain": "example.com" }` (any reasonable spelling is accepted and
 * normalized). Creates a pending site with a fresh verification token and
 * returns it. Claiming a domain you've already claimed returns the existing
 * site instead of an error, so the UI can simply navigate to it.
 */
export async function POST(request: Request) {
  const user = await getApiUser();
  if (!user) return jsonError(401, "Sign in to claim a domain.");

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(400, "Expected a JSON body like { \"domain\": \"example.com\" }.");

  const normalized = normalizeDomain(parsed.data.domain);
  if (!normalized.ok) return jsonError(400, normalized.error);

  try {
    const [site] = await db
      .insert(sites)
      .values({
        userId: user.id,
        domain: normalized.domain,
        verificationToken: generateVerificationToken(),
      })
      .returning();
    return NextResponse.json({ site }, { status: 201 });
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const [existing] = await db
      .select()
      .from(sites)
      .where(and(eq(sites.userId, user.id), eq(sites.domain, normalized.domain)));
    return NextResponse.json({ site: existing }, { status: 200 });
  }
}
