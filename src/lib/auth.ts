import "server-only";

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { headers } from "next/headers";
import { after } from "next/server";
import { redirect } from "next/navigation";

import { db } from "@/db";
import * as schema from "@/db/schema";
import { emailTransport, sendEmail } from "@/lib/email";
import { verificationEmail } from "@/lib/email-templates";
import { authRateLimitStorage } from "@/lib/rate-limit";

/** Whether new accounts must verify their email before signing in. See src/lib/email.ts. */
export const emailVerificationRequired = emailTransport !== "disabled";

const VERIFICATION_LINK_TTL_SECONDS = 60 * 60;

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
    // Off only when no email provider is configured in production, in which
    // case src/lib/email.ts logs a warning at startup.
    requireEmailVerification: emailVerificationRequired,
  },
  emailVerification: {
    sendOnSignUp: emailVerificationRequired,
    // Signing in to an unverified account emails a fresh link, so an expired
    // or lost one never strands the user.
    sendOnSignIn: emailVerificationRequired,
    autoSignInAfterVerification: true,
    expiresIn: VERIFICATION_LINK_TTL_SECONDS,
    sendVerificationEmail: async ({ user, url }) => {
      const { subject, text, html } = verificationEmail({
        url,
        issuerName: process.env.TRUSTTAB_ISSUER_NAME || "TrustTab",
        expiresInMinutes: VERIFICATION_LINK_TTL_SECONDS / 60,
      });
      // Send after the response: the sign-up/sign-in reply doesn't wait on the
      // provider, and its timing doesn't reveal whether an email went out.
      after(() =>
        sendEmail({ to: user.email, subject, text, html }).catch((err) =>
          console.error("[email] Failed to send verification email", err),
        ),
      );
    },
  },
  rateLimit: {
    // Better Auth's default rules (e.g. 3 sign-in/sign-up attempts per 10s per
    // IP) counted in Postgres rather than in memory, so they hold across
    // serverless instances. Keys are hashed; no raw IPs are stored. Enabled in
    // production only (Better Auth's default).
    customStorage: authRateLimitStorage,
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
