import "server-only";

/**
 * Outgoing email (currently: account verification only).
 *
 * Transports, chosen from the environment by `resolveEmailTransport`:
 * - "resend"   RESEND_API_KEY and EMAIL_FROM are set. Sends via Resend's HTTP
 *              API with plain fetch (no SDK). Self-hosters can replace
 *              `sendViaResend` with any provider.
 * - "console"  No provider configured, and either running `next dev` or
 *              EMAIL_TRANSPORT=console. Prints the email, including the
 *              verification link, to the server log. Never the default in
 *              production.
 * - "disabled" No provider configured in production. Email verification and
 *              password reset are turned off (see auth.ts) and a warning is
 *              logged, so signups keep working and the gap is visible.
 */

export type EmailTransport = "resend" | "console" | "disabled";

export function resolveEmailTransport(env: Record<string, string | undefined>): EmailTransport {
  if (env.RESEND_API_KEY && env.EMAIL_FROM) return "resend";
  if (env.EMAIL_TRANSPORT === "console" || env.NODE_ENV === "development") return "console";
  return "disabled";
}

export const emailTransport = resolveEmailTransport(process.env);

if (emailTransport === "disabled") {
  console.warn(
    "[email] No email provider configured (RESEND_API_KEY / EMAIL_FROM). Email verification and password reset are DISABLED: new accounts can sign in without verifying their address, and forgotten passwords can't be reset.",
  );
}

export type Email = { to: string; subject: string; text: string; html: string };

export async function sendEmail(email: Email): Promise<void> {
  switch (emailTransport) {
    case "resend":
      return sendViaResend(email);
    case "console":
      console.info(`[email:console] To: ${email.to}\nSubject: ${email.subject}\n\n${email.text}`);
      return;
    case "disabled":
      throw new Error("Email is not configured.");
  }
}

async function sendViaResend(email: Email): Promise<void> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM,
      to: [email.to],
      subject: email.subject,
      text: email.text,
      html: email.html,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    // Resend's error body describes the problem (e.g. unverified domain) and contains no secrets.
    throw new Error(`Resend responded ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
}
