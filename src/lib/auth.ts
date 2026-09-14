import "server-only";

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { db } from "@/db";
import * as schema from "@/db/schema";

/**
 * Better Auth server instance.
 *
 * Reads BETTER_AUTH_SECRET and BETTER_AUTH_URL from the environment; see
 * .env.example. The HTTP endpoints are mounted at /api/auth/* by
 * src/app/api/auth/[...all]/route.ts.
 */
export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.users,
      session: schema.sessions,
      account: schema.accounts,
      verification: schema.verifications,
    },
  }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 10,
    // Day-1 shortcut: we don't send verification emails yet, so an account is
    // usable immediately after sign-up. Revisit before public launch — it
    // requires an email provider (e.g. Resend) and a sending domain.
    requireEmailVerification: false,
  },
  // Must be the last plugin: lets server actions / route handlers set cookies.
  plugins: [nextCookies()],
});

export type Session = typeof auth.$Infer.Session;

/** Returns the current session, or null if the request isn't signed in. */
export async function getSession() {
  return auth.api.getSession({ headers: await headers() });
}

/**
 * For server components: returns the signed-in user or redirects to /login.
 * Call this in every protected page — layouts alone are not a sufficient
 * auth boundary in the App Router.
 */
export async function requireUser() {
  const session = await getSession();
  if (!session) redirect("/login");
  return session.user;
}
