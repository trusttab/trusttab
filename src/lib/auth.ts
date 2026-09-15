import "server-only";

import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware, isAPIError } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { headers } from "next/headers";
import { after } from "next/server";
import { redirect } from "next/navigation";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import * as schema from "@/db/schema";
import { emailTransport, sendEmail, type Email } from "@/lib/email";
import {
  accountDeletedEmail,
  passwordChangedEmail,
  passwordResetEmail,
  verificationEmail,
} from "@/lib/email-templates";
import { loginPath } from "@/lib/next-path";
import { authRateLimitStorage } from "@/lib/rate-limit";

/**
 * Whether this deployment can send email. When false (production with no
 * provider), email verification and password reset are both turned off, and
 * the UI hides them rather than promising emails that never arrive.
 */
export const emailEnabled = emailTransport !== "disabled";

const VERIFICATION_LINK_TTL_SECONDS = 60 * 60;
const RESET_LINK_TTL_SECONDS = 60 * 60;
const issuerName = () => process.env.TRUSTTAB_ISSUER_NAME || "TrustTab";

/**
 * Sends after the response is returned: auth replies don't wait on the email
 * provider, and their timing doesn't reveal whether an email went out.
 */
function sendInBackground(email: Email, purpose: string) {
  after(() => sendEmail(email).catch((err) => console.error(`[email] Failed to send ${purpose} email`, err)));
}

/** Tells the owner their password changed, if this deployment can send email. */
function notifyPasswordChanged(to: string, via: "reset" | "change") {
  if (!emailEnabled) return;
  const loginUrl = `${process.env.BETTER_AUTH_URL ?? ""}/login`;
  sendInBackground({ to, ...passwordChangedEmail({ issuerName: issuerName(), loginUrl, via }) }, "password changed");
}

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
    requireEmailVerification: emailEnabled,
    // Password reset. Better Auth answers identically whether or not the email
    // has an account, and reset tokens are single-use.
    ...(emailEnabled && {
      resetPasswordTokenExpiresIn: RESET_LINK_TTL_SECONDS,
      sendResetPassword: async ({ user, url }) => {
        const content = passwordResetEmail({
          url,
          issuerName: issuerName(),
          expiresInMinutes: RESET_LINK_TTL_SECONDS / 60,
        });
        sendInBackground({ to: user.email, ...content }, "password reset");
      },
    }),
    // A reset should lock out anyone who had the old password.
    revokeSessionsOnPasswordReset: true,
    onPasswordReset: async ({ user }) => {
      // Completing a reset required clicking a link sent to this address, which
      // proves the user controls it, so don't make them verify it separately.
      if (!user.emailVerified) {
        await db.update(schema.users).set({ emailVerified: true }).where(eq(schema.users.id, user.id));
      }
      notifyPasswordChanged(user.email, "reset");
    },
  },
  emailVerification: {
    sendOnSignUp: emailEnabled,
    // Signing in to an unverified account emails a fresh link, so an expired
    // or lost one never strands the user.
    sendOnSignIn: emailEnabled,
    autoSignInAfterVerification: true,
    expiresIn: VERIFICATION_LINK_TTL_SECONDS,
    sendVerificationEmail: async ({ user, url }) => {
      const content = verificationEmail({
        url,
        issuerName: issuerName(),
        expiresInMinutes: VERIFICATION_LINK_TTL_SECONDS / 60,
      });
      sendInBackground({ to: user.email, ...content }, "verification");
    },
  },
  user: {
    deleteUser: {
      // Deleting a user cascades in the database to their sites, manifests,
      // verification runs and traffic log (see src/db/schema.ts), so their
      // public manifests, registry entries and badges stop resolving.
      enabled: true,
      afterDelete: async (user) => {
        if (!emailEnabled) return;
        sendInBackground({ to: user.email, ...accountDeletedEmail({ issuerName: issuerName() }) }, "account deleted");
      },
    },
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      // Better Auth would otherwise delete an account with no password if the
      // session is under a day old, letting a stolen session cookie erase the
      // account. Always require the password (verified by the endpoint).
      if (ctx.path === "/delete-user") {
        const password = (ctx.body as { password?: unknown } | undefined)?.password;
        if (typeof password !== "string" || password.length === 0) {
          throw new APIError("BAD_REQUEST", {
            message: "Enter your password to delete your account.",
            code: "PASSWORD_REQUIRED",
          });
        }
      }
    }),
    after: createAuthMiddleware(async (ctx) => {
      // Signed-in password change (/dashboard/account). The client always asks
      // to revoke other sessions; here we send the same "password changed"
      // notice as a reset, but only if the change actually succeeded.
      if (ctx.path !== "/change-password" || isAPIError(ctx.context.returned)) return;
      const email = ctx.context.session?.user.email;
      if (email) notifyPasswordChanged(email, "change");
    }),
  },
  rateLimit: {
    // Better Auth's default rules (e.g. 3 sign-in/sign-up attempts per 10s per
    // IP) counted in Postgres rather than in memory, so they hold across
    // serverless instances. Keys are hashed; no raw IPs are stored. Enabled in
    // production only (Better Auth's default).
    customStorage: authRateLimitStorage,
    // Deleting an account checks a password, so limit guesses like sign-in.
    customRules: { "/delete-user": { window: 10, max: 3 } },
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
 *
 * Pass the page's own path (with any query string) as `returnTo` so the user
 * lands back there after logging in, e.g. from a browser-extension link.
 */
export async function requireUser(returnTo?: string) {
  const session = await getSession();
  if (!session) redirect(returnTo ? loginPath(returnTo) : "/login");
  return session.user;
}
