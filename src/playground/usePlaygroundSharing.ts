import { useCallback, useState } from "react";
import type { StoredProject } from "./usePlaygroundPersistence";
import { createSharedProjectPayload } from "./projectShare";
import { createShortShare } from "./projectShareApi";

type CurrentRef<T> = { current: T };
type ProjectSnapshot = StoredProject & { activePath: string };

type Args = {
  activeDraftIdRef: CurrentRef<string>;
  projectRef: CurrentRef<ProjectSnapshot>;
  saveDraftSnapshot: (draftId: string, snapshot: StoredProject) => Promise<void>;
  onNotice: (message: string) => void;
  onError: (cause: unknown) => void;
};

export function usePlaygroundSharing({
  activeDraftIdRef,
  projectRef,
  saveDraftSnapshot,
  onNotice,
  onError,
}: Args) {
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [sharing, setSharing] = useState(false);

  const openShareDialog = useCallback(() => setShareDialogOpen(true), []);
  const closeShareDialog = useCallback(() => setShareDialogOpen(false), []);

  const shareProject = useCallback(
    async () => {
      setSharing(true);
      const draftId = activeDraftIdRef.current;
      const snapshot = projectRef.current;
      try {
        await saveDraftSnapshot(draftId, snapshot);
        const payload = createSharedProjectPayload({
          source: snapshot.source,
          files: snapshot.files,
          activePath: snapshot.activePath,
        });
        const created = await createShortShare(payload, AbortSignal.timeout(15_000));
        const shareURL = new URL(window.location.href);
        shareURL.hash = "";
        shareURL.searchParams.delete("example");
        shareURL.searchParams.set("s", created.id);
        await navigator.clipboard.writeText(shareURL.href);
        history.replaceState(null, "", shareURL);
        onNotice("共有リンクをコピーしました");
        return true;
      } catch (cause) {
        onError(cause);
        return false;
      } finally {
        setSharing(false);
      }
    },
    [activeDraftIdRef, onError, onNotice, projectRef, saveDraftSnapshot],
  );

  return { shareDialogOpen, sharing, openShareDialog, closeShareDialog, shareProject };
}
