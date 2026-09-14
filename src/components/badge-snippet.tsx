"use client";

import { useState } from "react";

/** Embeddable badge preview and copyable HTML snippet. */
export function BadgeSnippet({ issuerUrl, verificationId }: { issuerUrl: string; verificationId: string }) {
  const [copied, setCopied] = useState(false);
  const badgeUrl = `${issuerUrl}/api/badge/${verificationId}.svg`;
  const pageUrl = `${issuerUrl}/verify/${verificationId}`;
  const snippet = `<a href="${pageUrl}"><img src="${badgeUrl}" alt="TrustTab verification status" height="20"></a>`;

  return (
    <section className="space-y-3 rounded-lg border border-zinc-200 bg-white p-5">
      <div>
        <h2 className="font-medium">Badge</h2>
        <p className="mt-1 text-sm text-zinc-600">
          Shows your live status and links to your public verification page. It updates automatically.
        </p>
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element -- live SVG from our own API; next/image adds nothing here */}
      <img src={badgeUrl} alt="Your current TrustTab badge" height={20} />
      <div className="flex items-stretch gap-2">
        <pre className="flex-1 overflow-x-auto rounded-md bg-zinc-900 px-3 py-2 font-mono text-xs text-zinc-100">{snippet}</pre>
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(snippet);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="rounded-md border border-zinc-300 px-3 text-xs font-medium hover:bg-zinc-100"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <p className="text-xs text-zinc-500">
        Public page:{" "}
        <a href={pageUrl} className="underline" target="_blank" rel="noreferrer">
          {pageUrl}
        </a>
      </p>
    </section>
  );
}
