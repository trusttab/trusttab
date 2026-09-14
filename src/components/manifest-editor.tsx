"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { fieldsToText, textToFields } from "@/lib/manifest/fields-text";
import { METHODS, PURPOSES, type ManifestInput, type Method, type Purpose } from "@/lib/manifest/types";

/** Endpoint as edited in the form: the field schema is kept as text. */
type EndpointDraft = {
  key: number;
  path: string;
  method: Method;
  purpose: Purpose;
  fieldsText: string;
  agent_safe: boolean;
  requires_captcha: boolean;
};

type Props = { siteId: string; initial: ManifestInput | null };

type ServerError = { error: string; details?: { path: string; message: string }[] };

let nextKey = 0;
const newEndpoint = (): EndpointDraft => ({
  key: nextKey++,
  path: "/contact",
  method: "POST",
  purpose: "lead_inquiry",
  fieldsText: "name: string\nemail: email\nmessage: string",
  agent_safe: true,
  requires_captcha: false,
});

export function ManifestEditor({ siteId, initial }: Props) {
  const router = useRouter();
  const [endpoints, setEndpoints] = useState<EndpointDraft[]>(() =>
    initial
      ? initial.endpoints.map((e) => ({ key: nextKey++, ...e, fieldsText: fieldsToText(e.schema) }))
      : [newEndpoint()],
  );
  const [rpm, setRpm] = useState(initial?.agent_rate_limit.requests_per_minute ?? 30);
  const [captchaExempt, setCaptchaExempt] = useState(initial?.agent_rate_limit.captcha_exempt ?? false);
  const [pledge, setPledge] = useState(initial?.no_prompt_injection_pledge ?? false);
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [published, setPublished] = useState<number | null>(null);

  const update = (key: number, patch: Partial<EndpointDraft>) =>
    setEndpoints((list) => list.map((e) => (e.key === key ? { ...e, ...patch } : e)));

  async function publish() {
    setErrors([]);
    setPublished(null);

    const parsedEndpoints = [];
    for (const [i, e] of endpoints.entries()) {
      const fields = textToFields(e.fieldsText);
      if (!fields.ok) return setErrors([`Endpoint ${i + 1}: ${fields.error}`]);
      const { key: _key, fieldsText: _text, ...rest } = e;
      void _key;
      void _text;
      parsedEndpoints.push({ ...rest, schema: fields.schema });
    }

    const body: ManifestInput = {
      no_prompt_injection_pledge: pledge,
      agent_rate_limit: { requests_per_minute: rpm, captcha_exempt: captchaExempt },
      endpoints: parsedEndpoints,
    };

    setPending(true);
    try {
      const res = await fetch(`/api/sites/${siteId}/manifest`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = data as ServerError;
        setErrors(
          err.details?.length
            ? err.details.map((d) => `${describePath(d.path)} ${d.message}`)
            : [err.error ?? `Publish failed (HTTP ${res.status}).`],
        );
        return;
      }
      setPublished(data.version);
      router.refresh();
    } catch {
      setErrors(["Network error — please try again."]);
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="space-y-5 rounded-lg border border-zinc-200 bg-white p-5">
      <div>
        <h2 className="font-medium">Manifest editor</h2>
        <p className="mt-1 text-sm text-zinc-600">
          Declare the forms on your site that AI agents may use. Publishing signs a new manifest
          version.
        </p>
      </div>

      {endpoints.map((e, i) => (
        <fieldset key={e.key} className="space-y-3 rounded-md border border-zinc-200 p-4">
          <div className="flex items-center justify-between">
            <legend className="text-sm font-medium">Endpoint {i + 1}</legend>
            {endpoints.length > 1 && (
              <button
                type="button"
                onClick={() => setEndpoints((list) => list.filter((x) => x.key !== e.key))}
                className="text-xs text-red-700 hover:underline"
              >
                Remove
              </button>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
            <label className="space-y-1 text-sm">
              <span className="font-medium">Page path</span>
              <input
                value={e.path}
                onChange={(ev) => update(e.key, { path: ev.target.value })}
                className="w-full rounded-md border border-zinc-300 px-3 py-2 font-mono"
                placeholder="/contact"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">Method</span>
              <select
                value={e.method}
                onChange={(ev) => update(e.key, { method: ev.target.value as Method })}
                className="w-full rounded-md border border-zinc-300 px-3 py-2"
              >
                {METHODS.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">Purpose</span>
              <select
                value={e.purpose}
                onChange={(ev) => update(e.key, { purpose: ev.target.value as Purpose })}
                className="w-full rounded-md border border-zinc-300 px-3 py-2"
              >
                {PURPOSES.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="block space-y-1 text-sm">
            <span className="font-medium">Fields</span>
            <textarea
              value={e.fieldsText}
              onChange={(ev) => update(e.key, { fieldsText: ev.target.value })}
              rows={Math.max(3, e.fieldsText.split("\n").length)}
              spellCheck={false}
              className="w-full rounded-md border border-zinc-300 px-3 py-2 font-mono text-xs"
            />
            <span className="block text-xs text-zinc-500">
              One per line: <code>input_name: type</code>. Types: string, number, boolean, email, phone,
              url, date, file, array&lt;type&gt;, enum[a,b,c]. Add <code>?</code> for optional.
            </span>
          </label>
          <div className="flex flex-wrap gap-5 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={e.agent_safe}
                onChange={(ev) => update(e.key, { agent_safe: ev.target.checked })}
              />
              Safe for agents to submit
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={e.requires_captcha}
                onChange={(ev) => update(e.key, { requires_captcha: ev.target.checked })}
              />
              Requires CAPTCHA
            </label>
          </div>
        </fieldset>
      ))}

      <button
        type="button"
        onClick={() => setEndpoints((list) => [...list, newEndpoint()])}
        className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100"
      >
        + Add endpoint
      </button>

      <div className="space-y-3 border-t border-zinc-200 pt-4 text-sm">
        <div className="flex flex-wrap items-end gap-5">
          <label className="space-y-1">
            <span className="block font-medium">Agent rate limit (requests/minute)</span>
            <input
              type="number"
              min={1}
              max={10000}
              value={rpm}
              onChange={(ev) => setRpm(Number(ev.target.value))}
              className="w-32 rounded-md border border-zinc-300 px-3 py-2"
            />
          </label>
          <label className="flex items-center gap-2 pb-2">
            <input type="checkbox" checked={captchaExempt} onChange={(ev) => setCaptchaExempt(ev.target.checked)} />
            Agents within the limit skip CAPTCHA
          </label>
        </div>
        <label className="flex items-start gap-2">
          <input type="checkbox" className="mt-1" checked={pledge} onChange={(ev) => setPledge(ev.target.checked)} />
          <span>
            I pledge that these pages contain no hidden content intended to manipulate AI agents
            (required).
          </span>
        </label>
      </div>

      {errors.length > 0 && (
        <ul role="alert" className="list-disc space-y-1 rounded-md bg-red-50 py-2 pr-3 pl-8 text-sm text-red-700">
          {errors.map((err) => (
            <li key={err}>{err}</li>
          ))}
        </ul>
      )}
      {published !== null && (
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Published and signed as version {published}.
        </p>
      )}

      <button
        type="button"
        onClick={publish}
        disabled={pending}
        className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
      >
        {pending ? "Signing…" : "Sign & publish manifest"}
      </button>
    </section>
  );
}

/** Turns a JSON pointer like "/endpoints/0/schema/email" into "Endpoint 1 › schema › email:". */
function describePath(pointer: string): string {
  const parts = pointer.split("/").filter(Boolean);
  const labels = parts.map((p, i) => (parts[i - 1] === "endpoints" ? String(Number(p) + 1) : p));
  const text = labels.join(" › ").replace(/^endpoints › (\d+)/, "Endpoint $1");
  return text ? `${text}:` : "Manifest:";
}
