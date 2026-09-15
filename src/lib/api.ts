import "server-only";

import { NextResponse } from "next/server";

import { getSession } from "./auth";

/** Consistent JSON error shape for API routes: `{ error: string }`. */
export function jsonError(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

/** Returns the signed-in user for an API route, or null. */
export async function getApiUser() {
  const session = await getSession();
  return session?.user ?? null;
}

/** Returns the signed-in user and their session for an API route, or null. */
export async function getApiSession() {
  const session = await getSession();
  return session ? { user: session.user, sessionId: session.session.id } : null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: string) => UUID_RE.test(value);

/** True if `err` (or its cause, as wrapped by Drizzle) is a Postgres unique violation. */
export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === "23505" || e?.cause?.code === "23505";
}
