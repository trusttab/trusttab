"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useRef, useState } from "react";

import type { ManifestInput } from "@/lib/manifest/types";

import { AssistantPanel } from "./assistant-panel";
import { ManifestEditor, type AssistantChange, type DraftState } from "./manifest-editor";

/**
 * The assistant and the manifest editor are coupled, and they now sit in
 * different columns of the page: the editor's pending edits are saved before
 * each assistant message, the editor is read-only while the assistant works,
 * and it reloads the draft afterwards so the assistant's changes appear in
 * place.
 *
 * Splitting them across the layout must not quietly drop any of that, so the
 * coupling lives in this context and both columns render inside the provider.
 * Nothing about what the assistant can do changes; only where it is drawn.
 */
type WorkspaceValue = {
  /** Saves the editor's pending edits. Resolves false to abort the message. */
  flushEditor: () => Promise<boolean>;
  registerFlush: (flush: () => Promise<boolean>) => void;
  assistantBusy: boolean;
  setAssistantBusy: (busy: boolean) => void;
  onDraftChanged: () => void;
};

const WorkspaceContext = createContext<WorkspaceValue | null>(null);

function useWorkspace(component: string): WorkspaceValue {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error(`${component} must be rendered inside SiteWorkspaceProvider`);
  return value;
}

export function SiteWorkspaceProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [assistantBusy, setAssistantBusy] = useState(false);
  const flush = useRef<() => Promise<boolean>>(async () => true);

  const registerFlush = useCallback((next: () => Promise<boolean>) => {
    flush.current = next;
  }, []);
  const flushEditor = useCallback(() => flush.current(), []);
  const onDraftChanged = useCallback(() => router.refresh(), [router]);

  return (
    <WorkspaceContext.Provider value={{ flushEditor, registerFlush, assistantBusy, setAssistantBusy, onDraftChanged }}>
      {children}
    </WorkspaceContext.Provider>
  );
}

/** The assistant, in the page's own column. */
export function AssistantColumn({ siteId, domain }: { siteId: string; domain: string }) {
  const { flushEditor, setAssistantBusy, onDraftChanged } = useWorkspace("AssistantColumn");
  return (
    <AssistantPanel
      siteId={siteId}
      domain={domain}
      beforeSend={flushEditor}
      onBusyChange={setAssistantBusy}
      onDraftChanged={onDraftChanged}
    />
  );
}

/** The manifest editor, which is all "Your declared forms" contains now. */
export function ManifestEditorSection({
  siteId,
  draft,
  published,
  assistantChanges,
}: {
  siteId: string;
  draft: DraftState;
  published: ManifestInput | null;
  assistantChanges: AssistantChange[];
}) {
  const { registerFlush, assistantBusy } = useWorkspace("ManifestEditorSection");
  return (
    // Remount when the saved draft changes on the server (e.g. assistant edits), so the editor shows it.
    <ManifestEditor
      key={`${draft.version}:${draft.hash}`}
      siteId={siteId}
      draft={draft}
      published={published}
      assistantChanges={assistantChanges}
      locked={assistantBusy}
      onFlushReady={registerFlush}
    />
  );
}
