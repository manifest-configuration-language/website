import { useCallback, useState } from "react";
import {
  clearSharedDraftRecovery,
  resetSharedDraftRecovery,
  type SharedDraftRecovery,
  type StoredProject,
} from "./usePlaygroundPersistence";
import { createSharedProjectPayload, encodeSharedProject } from "./projectShare";
import { createShortShare } from "./projectShareApi";

export type PlaygroundShareMode = "short" | "fragment";

export type SharedRecoveryState = {
  metadata: SharedDraftRecovery;
  base: StoredProject;
};

type CurrentRef<T> = { current: T };
type ProjectSnapshot = StoredProject & { activePath: string };

type Args = {
  activeDraftIdRef: CurrentRef<string>;
  projectRef: CurrentRef<ProjectSnapshot>;
  sharedRecovery: CurrentRef<SharedRecoveryState | undefined>;
  saveDraftSnapshot: (draftId: string, snapshot: StoredProject) => Promise<void>;
  onNotice: (message: string) => void;
  onError: (cause: unknown) => void;
};

export function usePlaygroundSharing({
  activeDraftIdRef,
  projectRef,
  sharedRecovery,
  saveDraftSnapshot,
  onNotice,
  onError,
}: Args) {
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [sharing, setSharing] = useState(false);

  const openShareDialog = useCallback(() => setShareDialogOpen(true), []);
  const closeShareDialog = useCallback(() => setShareDialogOpen(false), []);

  const shareProject = useCallback(
    async (mode: PlaygroundShareMode) => {
      setSharing(true);
      const draftId = activeDraftIdRef.current;
      const snapshot = projectRef.current;
      try {
        await saveDraftSnapshot(draftId, snapshot);
        let shareURL: URL;
        let shareNotice: string;
        let nextRecovery: SharedRecoveryState | undefined;
        let resetRecovery = false;
        if (mode === "short") {
          const payload = createSharedProjectPayload({
            source: snapshot.source,
            files: snapshot.files,
            activePath: snapshot.activePath,
          });
          const created = await createShortShare(payload, AbortSignal.timeout(15_000));
          shareURL = new URL(window.location.href);
          shareURL.hash = "";
          shareURL.searchParams.delete("example");
          shareURL.searchParams.set("s", created.id);
          resetRecovery = true;
          const expiration = new Intl.DateTimeFormat("ja-JP", { dateStyle: "long" }).format(
            new Date(created.expiresAt),
          );
          shareNotice = `共有URLをコピーしました（${expiration}まで有効。URLを知る人は閲覧できます）`;
        } else {
          const fragment = await encodeSharedProject(snapshot);
          shareURL = new URL(window.location.href);
          shareURL.searchParams.delete("s");
          shareURL.hash = fragment.slice(1);
          const metadata = { draftId, fragment, activePath: snapshot.activePath };
          nextRecovery = {
            metadata,
            base: {
              source: snapshot.source,
              files: snapshot.files,
              activePath: snapshot.activePath,
            },
          };
          shareNotice = "プロジェクトをURLに埋め込んでコピーしました";
        }
        await navigator.clipboard.writeText(shareURL.href);
        history.replaceState(null, "", shareURL);
        if (resetRecovery) {
          clearSharedDraftRecovery(draftId);
        } else if (nextRecovery) {
          resetSharedDraftRecovery(nextRecovery.metadata);
        }
        sharedRecovery.current = nextRecovery;
        onNotice(shareNotice);
        return true;
      } catch (cause) {
        onError(cause);
        return false;
      } finally {
        setSharing(false);
      }
    },
    [activeDraftIdRef, onError, onNotice, projectRef, saveDraftSnapshot, sharedRecovery],
  );

  return { shareDialogOpen, sharing, openShareDialog, closeShareDialog, shareProject };
}
