"use client";

import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";

import type { ManifestInput } from "@/lib/manifest/types";

import { AssistantPanel } from "./assistant-panel";
import { ManifestEditor, type AssistantChange, type DraftState } from "./manifest-editor";

type Props = {
  siteId: string;
  domain: string;
  draft: DraftState;
  published: ManifestInput | null;
  assistantChanges: AssistantChange[];
  assistantEnabled: boolean;
};

/**
 * Coordinates the assistant and the editor on one site's draft: the editor's
 * pending edits are saved before each assistant message, the editor is
 * read-only while the assistant works, and it reloads the draft afterwards so
 * the assistant's changes appear in place.
 */
export function SiteWorkspace({ siteId, domain, draft, published, assistantChanges, assistantEnabled }: Props) {
  const router = useRouter();
  const [assistantBusy, setAssistantBusy] = useState(false);
  const flushEditor = useRef<() => Promise<boolean>>(async () => true);
  const onFlushReady = useCallback((flush: () => Promise<boolean>) => {
    flushEditor.current = flush;
  }, []);

  return (
    <>
      {assistantEnabled && (
        <AssistantPanel
          siteId={siteId}
          domain={domain}
          beforeSend={() => flushEditor.current()}
          onBusyChange={setAssistantBusy}
          onDraftChanged={() => router.refresh()}
        />
      )}
      {/* Remount when the saved draft changes on the server (e.g. assistant edits), so the editor shows it. */}
      <ManifestEditor
        key={`${draft.version}:${draft.hash}`}
        siteId={siteId}
        draft={draft}
        published={published}
        assistantChanges={assistantChanges}
        locked={assistantBusy}
        onFlushReady={onFlushReady}
      />
    </>
  );
}
