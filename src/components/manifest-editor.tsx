"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { diffManifestInputs } from "@/lib/manifest/diff";
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
  self_attested: boolean;
};

export type DraftState = { input: ManifestInput; version: number; hash: string };
export type AssistantChange = { id: string; summary: string; reason: string };

type Props = {
  siteId: string;
  draft: DraftState;
  /** The currently published declarations, or null if nothing is published yet. */
  published: ManifestInput | null;
  /** Changes the assistant made since the last publish, oldest first. */
  assistantChanges: AssistantChange[];
  /** True while the assistant is working; the editor is read-only meanwhile. */
  locked: boolean;
  /** Receives a function that saves pending edits now; resolves false if they couldn't be saved. */
  onFlushReady?: (flush: () => Promise<boolean>) => void;
};

type SaveState = "saved" | "unsaved" | "saving" | "invalid" | "conflict" | "error";
type ServerError = { error: string; details?: { path: string; message: string }[] };

const AUTOSAVE_DELAY_MS = 800;

let nextKey = 0;
const newEndpoint = (): EndpointDraft => ({
  key: nextKey++,
  path: "/contact",
  method: "POST",
  purpose: "lead_inquiry",
  fieldsText: "name: string\nemail: email\nmessage: string",
  agent_safe: true,
  requires_captcha: false,
  self_attested: false,
});

/**
 * The manifest editor. Edits the site's saved draft (autosaved), which the
 * dashboard assistant also edits; its changes show up here highlighted.
 * Publishing is a separate, human-only two-step flow behind a review of
 * exactly what will be signed (see src/lib/publish-gate.ts).
 */
export function ManifestEditor({ siteId, draft, published, assistantChanges, locked, onFlushReady }: Props) {
  const router = useRouter();
  const [endpoints, setEndpoints] = useState<EndpointDraft[]>(() =>
    draft.input.endpoints.map((e) => ({
      key: nextKey++,
      path: e.path,
      method: e.method,
      purpose: e.purpose,
      agent_safe: e.agent_safe,
      requires_captcha: e.requires_captcha,
      self_attested: e.self_attested ?? false,
      fieldsText: fieldsToText(e.schema),
    })),
  );
  const [rpm, setRpm] = useState(draft.input.agent_rate_limit.requests_per_minute);
  const [captchaExempt, setCaptchaExempt] = useState(draft.input.agent_rate_limit.captcha_exempt);
  const [pledge, setPledge] = useState(draft.input.no_prompt_injection_pledge);

  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const version = useRef(draft.version);
  const [hash, setHash] = useState(draft.hash);
  const editSeq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstRender = useRef(true);

  const [reviewing, setReviewing] = useState(false);
  const [reviewedOk, setReviewedOk] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [publishedVersion, setPublishedVersion] = useState<number | null>(null);

  const update = (key: number, patch: Partial<EndpointDraft>) =>
    setEndpoints((list) => list.map((e) => (e.key === key ? { ...e, ...patch } : e)));

  const buildInput = useCallback((): { ok: true; input: ManifestInput } | { ok: false; error: string } => {
    const parsed: ManifestInput["endpoints"] = [];
    for (const [i, e] of endpoints.entries()) {
      const fields = textToFields(e.fieldsText);
      if (!fields.ok) return { ok: false, error: `Endpoint ${i + 1}: ${fields.error}` };
      const { key: _key, fieldsText: _text, ...rest } = e;
      void _key;
      void _text;
      parsed.push({ ...rest, schema: fields.schema });
    }
    return {
      ok: true,
      input: {
        no_prompt_injection_pledge: pledge,
        agent_rate_limit: { requests_per_minute: rpm, captcha_exempt: captchaExempt },
        endpoints: parsed,
      },
    };
  }, [endpoints, rpm, captchaExempt, pledge]);

  const save = useCallback(async (): Promise<boolean> => {
    const built = buildInput();
    if (!built.ok) {
      setSaveState("invalid");
      setSaveMessage(built.error);
      return false;
    }
    const seq = editSeq.current;
    setSaveState("saving");
    try {
      const res = await fetch(`/api/sites/${siteId}/draft`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input: built.input, baseVersion: version.current }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409) {
        setSaveState("conflict");
        setSaveMessage("The draft was changed elsewhere (by the assistant or another tab).");
        return false;
      }
      if (!res.ok) {
        setSaveState("error");
        setSaveMessage((data as ServerError).error ?? `Couldn't save the draft (HTTP ${res.status}).`);
        return false;
      }
      version.current = data.draft.version;
      setHash(data.draft.hash);
      // Only mark saved if nothing was edited while this save was in flight.
      if (editSeq.current === seq) {
        setSaveState("saved");
        setSaveMessage(null);
      }
      return true;
    } catch {
      setSaveState("error");
      setSaveMessage("Network error while saving the draft.");
      return false;
    }
  }, [buildInput, siteId]);

  // Autosave shortly after each edit.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    editSeq.current += 1;
    setSaveState("unsaved");
    setReviewing(false);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), AUTOSAVE_DELAY_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // `save` changes whenever the fields do; depending on the fields is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoints, rpm, captchaExempt, pledge]);

  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    if (saveState === "saved") return true;
    return save();
  }, [save, saveState]);

  useEffect(() => onFlushReady?.(flush), [flush, onFlushReady]);

  const current = buildInput();
  const diff = useMemo(() => (current.ok ? diffManifestInputs(published, current.input) : []), [current, published]);
  const assistantTouched = useMemo(
    () => new Set(assistantChanges.flatMap((c) => [...c.summary.matchAll(/\b(GET|POST) (\/\S*)/g)].map((m) => `${m[1]} ${m[2]}`))),
    [assistantChanges],
  );
  const needsReviewCheckbox = assistantChanges.length > 0;

  async function openReview() {
    setErrors([]);
    setPublishedVersion(null);
    setReviewedOk(false);
    if (!(await flush())) return;
    setReviewing(true);
  }

  async function signAndPublish() {
    setErrors([]);
    setPublishing(true);
    try {
      // Step 1: a single-use confirmation for exactly the draft reviewed above.
      const confirmRes = await fetch(`/api/sites/${siteId}/publish/confirm`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ draftHash: hash }),
      });
      const confirmData = await confirmRes.json().catch(() => ({}));
      if (!confirmRes.ok) return failPublish(confirmRes.status, confirmData as ServerError);

      // Step 2: sign and publish that draft.
      const res = await fetch(`/api/sites/${siteId}/manifest`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ draftHash: hash, confirmation: confirmData.confirmation }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return failPublish(res.status, data as ServerError);

      setPublishedVersion(data.version);
      setReviewing(false);
      router.refresh();
    } catch {
      setErrors(["Network error — please try again."]);
    } finally {
      setPublishing(false);
    }
  }

  function failPublish(status: number, err: ServerError) {
    if (status === 409) {
      setReviewing(false);
      setErrors([err.error ?? "The draft changed. Reload and review it again."]);
      router.refresh();
      return;
    }
    setErrors(
      err.details?.length ? err.details.map((d) => `${describePath(d.path)} ${d.message}`) : [err.error ?? `Publish failed (HTTP ${status}).`],
    );
  }

  return (
    <section className="space-y-5 rounded-lg border border-zinc-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-medium">Manifest editor</h2>
          <p className="mt-1 text-sm text-zinc-600">
            Declare the forms on your site that AI agents may use. Your draft saves automatically; nothing is public
            until you sign and publish it.
          </p>
        </div>
        <SaveIndicator state={saveState} />
      </div>

      {locked && (
        <p className="rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-900">The assistant is working on your draft…</p>
      )}
      {saveMessage && (saveState === "invalid" || saveState === "error" || saveState === "conflict") && (
        <p role="alert" className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {saveMessage}{" "}
          {saveState === "conflict" && (
            <button type="button" className="underline" onClick={() => router.refresh()}>
              Load the latest draft
            </button>
          )}
        </p>
      )}

      <fieldset disabled={locked || publishing} className="space-y-5 disabled:opacity-70">
        {endpoints.length === 0 && (
          <p className="rounded-md border border-dashed border-zinc-300 p-4 text-sm text-zinc-500">
            No endpoints yet. Add one, or ask the assistant to draft them from your site&apos;s forms.
          </p>
        )}
        {endpoints.map((e, i) => {
          const touched = assistantTouched.has(`${e.method} ${e.path}`);
          return (
            <fieldset
              key={e.key}
              className={`space-y-3 rounded-md border p-4 ${touched ? "border-blue-300 ring-2 ring-blue-100" : "border-zinc-200"}`}
            >
              <div className="flex items-center justify-between gap-2">
                <legend className="text-sm font-medium">
                  Endpoint {i + 1}
                  {touched && (
                    <span className="ml-2 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-800 ring-1 ring-blue-200">
                      Changed by assistant
                    </span>
                  )}
                </legend>
                <button
                  type="button"
                  onClick={() => setEndpoints((list) => list.filter((x) => x.key !== e.key))}
                  className="text-xs text-red-700 hover:underline"
                >
                  Remove
                </button>
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
                  One per line: <code>input_name: type</code>. Types: string, number, boolean, email, phone, url, date,
                  file, array&lt;type&gt;, enum[a,b,c]. Add <code>?</code> for optional.
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
              <label className="flex items-start gap-2 rounded-md bg-blue-50 p-2 text-xs text-blue-900">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={e.self_attested}
                  onChange={(ev) => update(e.key, { self_attested: ev.target.checked })}
                />
                <span>
                  <span className="font-medium">Self-attest this form.</span> Use only if TrustTab can&apos;t see the
                  form because it&apos;s rendered by JavaScript. I declare it exists at this path with these fields. If
                  the automated check can&apos;t confirm it, this endpoint is shown publicly as{" "}
                  <span className="font-medium">self-declared, not verified</span>, and the site can reach
                  &quot;Self-declared&quot; status at most.
                </span>
              </label>
            </fieldset>
          );
        })}

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
            <span>I pledge that these pages contain no hidden content intended to manipulate AI agents (required).</span>
          </label>
        </div>
      </fieldset>

      {errors.length > 0 && (
        <ul role="alert" className="list-disc space-y-1 rounded-md bg-red-50 py-2 pr-3 pl-8 text-sm text-red-700">
          {errors.map((err) => (
            <li key={err}>{err}</li>
          ))}
        </ul>
      )}
      {publishedVersion !== null && (
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Published and signed as version {publishedVersion}.
        </p>
      )}

      {!reviewing ? (
        <button
          type="button"
          onClick={openReview}
          disabled={locked || publishing || saveState === "saving"}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
        >
          Review &amp; publish…
        </button>
      ) : (
        <div className="space-y-4 rounded-md border border-zinc-300 bg-zinc-50 p-4">
          <h3 className="font-medium">Review before you sign</h3>
          {diff.length === 0 ? (
            <p className="text-sm text-zinc-600">No changes since the last published version.</p>
          ) : (
            <div className="space-y-1">
              <p className="text-sm font-medium">What will change{published ? " compared with your published manifest" : ""}:</p>
              <ul className="space-y-1 text-sm">
                {diff.map((line, i) => (
                  <li
                    key={i}
                    className={
                      line.kind === "attestation"
                        ? "rounded bg-blue-50 px-2 py-1 font-medium text-blue-900"
                        : line.kind === "removed"
                          ? "text-red-800"
                          : "text-zinc-800"
                    }
                  >
                    {line.kind === "added" ? "+ " : line.kind === "removed" ? "− " : line.kind === "attestation" ? "✎ " : "~ "}
                    {line.text}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {assistantChanges.length > 0 && (
            <div className="space-y-1">
              <p className="text-sm font-medium">The assistant made these changes. Check they&apos;re right:</p>
              <ul className="list-disc space-y-1 pl-5 text-sm text-zinc-700">
                {assistantChanges.map((c) => (
                  <li key={c.id}>
                    <span className="font-medium">{c.summary}</span>
                    {c.reason && <span className="text-zinc-600">: {c.reason}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-sm text-zinc-600">
            Publishing signs these declarations as yours. They become public at your manifest URL.
          </p>
          {needsReviewCheckbox && (
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={reviewedOk} onChange={(ev) => setReviewedOk(ev.target.checked)} />
              <span>I&apos;ve reviewed the assistant&apos;s changes, and these declarations are accurate.</span>
            </label>
          )}
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={signAndPublish}
              disabled={publishing || locked || (needsReviewCheckbox && !reviewedOk)}
              className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
            >
              {publishing ? "Signing…" : "Sign & publish manifest"}
            </button>
            <button
              type="button"
              onClick={() => setReviewing(false)}
              className="rounded-md border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-100"
            >
              Keep editing
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function SaveIndicator({ state }: { state: SaveState }) {
  const label: Record<SaveState, string> = {
    saved: "Draft saved",
    unsaved: "Unsaved changes",
    saving: "Saving…",
    invalid: "Not saved: fix the fields",
    conflict: "Not saved: draft changed",
    error: "Not saved",
  };
  const tone = state === "saved" ? "text-zinc-500" : state === "unsaved" || state === "saving" ? "text-zinc-600" : "text-amber-700";
  return <span className={`text-xs ${tone}`}>{label[state]}</span>;
}

/** Turns a JSON pointer like "/endpoints/0/schema/email" into "Endpoint 1 › schema › email:". */
function describePath(pointer: string): string {
  const parts = pointer.split("/").filter(Boolean);
  const labels = parts.map((p, i) => (parts[i - 1] === "endpoints" ? String(Number(p) + 1) : p));
  const text = labels.join(" › ").replace(/^endpoints › (\d+)/, "Endpoint $1");
  return text ? `${text}:` : "Manifest:";
}
