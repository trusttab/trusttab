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
