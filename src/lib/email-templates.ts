/**
 * Email bodies. Pure functions (no server-only imports) so they can be tested.
 * Kept deliberately plain: a text part and minimal inline-styled HTML.
 */

const escapeHtml = (text: string) =>
  text.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" })[c]!);

export function verificationEmail(args: { url: string; issuerName: string; expiresInMinutes: number }) {
  const { url, issuerName, expiresInMinutes } = args;
  const subject = `Verify your email for ${issuerName}`;
  const text = [
    `Confirm your email address to finish creating your ${issuerName} account:`,
    "",
    url,
    "",
    `This link expires in ${expiresInMinutes} minutes. If you didn't sign up, you can ignore this email.`,
  ].join("\n");

  const html = `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;color:#18181b">
  <p>Confirm your email address to finish creating your ${escapeHtml(issuerName)} account.</p>
  <p><a href="${escapeHtml(url)}" style="display:inline-block;background:#18181b;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Verify email</a></p>
  <p style="color:#52525b;font-size:13px">Or paste this link into your browser:<br>${escapeHtml(url)}</p>
  <p style="color:#52525b;font-size:13px">This link expires in ${expiresInMinutes} minutes. If you didn't sign up, you can ignore this email.</p>
</div>`;

  return { subject, text, html };
}

export function passwordResetEmail(args: { url: string; issuerName: string; expiresInMinutes: number }) {
  const { url, issuerName, expiresInMinutes } = args;
  const subject = `Reset your ${issuerName} password`;
  const text = [
    `Someone (hopefully you) asked to reset the password for your ${issuerName} account. To choose a new password, open:`,
    "",
    url,
    "",
    `This link expires in ${expiresInMinutes} minutes and can be used once. If you didn't ask for this, you can ignore this email; your password won't change.`,
  ].join("\n");

  const html = `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;color:#18181b">
  <p>Someone (hopefully you) asked to reset the password for your ${escapeHtml(issuerName)} account.</p>
  <p><a href="${escapeHtml(url)}" style="display:inline-block;background:#18181b;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Choose a new password</a></p>
  <p style="color:#52525b;font-size:13px">Or paste this link into your browser:<br>${escapeHtml(url)}</p>
  <p style="color:#52525b;font-size:13px">This link expires in ${expiresInMinutes} minutes and can be used once. If you didn't ask for this, you can ignore this email; your password won't change.</p>
</div>`;

  return { subject, text, html };
}

/**
 * Sent after a password reset or change, so an owner learns if someone else
 * changed their password. `via` only affects which sessions were signed out.
 */
export function passwordChangedEmail(args: { issuerName: string; loginUrl: string; via: "reset" | "change" }) {
  const { issuerName, loginUrl, via } = args;
  const signedOut =
    via === "reset" ? "you've been signed out on all devices" : "all your other devices have been signed out";
  const subject = `Your ${issuerName} password was changed`;
  const text = [
    `The password for your ${issuerName} account was just changed, and ${signedOut}.`,
    "",
    `If this was you, no action is needed: ${loginUrl}`,
    "",
    'If it wasn\'t you, someone may have access to your email account. Secure your email, then use "Forgot password?" on the login page to set a new password.',
  ].join("\n");

  const html = `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;color:#18181b">
  <p>The password for your ${escapeHtml(issuerName)} account was just changed, and ${signedOut}.</p>
  <p>If this was you, no action is needed.</p>
  <p>If it wasn't you, someone may have access to your email account. Secure your email, then use <strong>Forgot password?</strong> on the <a href="${escapeHtml(loginUrl)}">login page</a> to set a new password.</p>
</div>`;

  return { subject, text, html };
}

/** Sent after an account is deleted, so an owner learns if someone else did it. */
export function accountDeletedEmail(args: { issuerName: string }) {
  const { issuerName } = args;
  const subject = `Your ${issuerName} account was deleted`;
  const text = [
    `Your ${issuerName} account and all of its sites, manifests and verification history were just deleted. Badges and public verification pages for those sites no longer resolve.`,
    "",
    "This can't be undone. If you didn't do this, someone had your password: change it anywhere you reused it, and secure your email account.",
  ].join("\n");
  const html = `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;color:#18181b">
  <p>Your ${escapeHtml(issuerName)} account and all of its sites, manifests and verification history were just deleted. Badges and public verification pages for those sites no longer resolve.</p>
  <p>This can't be undone. If you didn't do this, someone had your password: change it anywhere you reused it, and secure your email account.</p>
</div>`;
  return { subject, text, html };
}
