import type { manifests } from "@/db/schema";

type ManifestRow = typeof manifests.$inferSelect;

/** Server component: shows the live manifest and how to serve it from the site. */
export function PublishedManifest({
  manifest,
  domain,
  issuerUrl,
  expired,
}: {
  manifest: ManifestRow;
  domain: string;
  issuerUrl: string;
  /** Computed by the caller at request time (components must stay pure). */
  expired: boolean;
}) {
  const publicUrl = `${issuerUrl}/api/manifest/${domain}`;

  return (
    <section className="space-y-4 rounded-lg border border-zinc-200 bg-white p-5">
      <div>
        <h2 className="font-medium">Published manifest</h2>
        <p className="mt-1 text-sm text-zinc-600">
          Version {manifest.version} · published {manifest.createdAt.toLocaleString()} ·{" "}
          <span className={expired ? "font-medium text-red-700" : undefined}>
            {expired ? "expired" : "expires"} {manifest.expiresAt.toLocaleDateString()}
          </span>{" "}
          · verification checks: <span className="font-medium">not run yet</span>
        </p>
      </div>

      <div className="space-y-2 text-sm text-zinc-700">
        <p>
          Public URL:{" "}
          <a href={publicUrl} className="font-mono break-all underline" target="_blank" rel="noreferrer">
            {publicUrl}
          </a>
        </p>
        <p>
          Make it available at <code className="font-mono">https://{domain}/.well-known/agent-trust.json</code>{" "}
          by adding a redirect (or proxy) from that path to the public URL. For example, on Vercel
          (<code className="font-mono">vercel.json</code>):
        </p>
        <pre className="overflow-x-auto rounded-md bg-zinc-900 px-3 py-2 font-mono text-xs text-zinc-100">
          {JSON.stringify(
            { redirects: [{ source: "/.well-known/agent-trust.json", destination: publicUrl, permanent: false }] },
            null,
            2,
          )}
        </pre>
      </div>

      <details className="text-sm">
        <summary className="cursor-pointer font-medium">View signed JSON</summary>
        <pre className="mt-2 max-h-96 overflow-auto rounded-md bg-zinc-50 p-3 font-mono text-xs">
          {JSON.stringify(manifest.payloadJson, null, 2)}
        </pre>
      </details>
    </section>
  );
}
