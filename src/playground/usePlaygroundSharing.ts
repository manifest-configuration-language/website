import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { playgroundLocale } from "./playgroundI18n";
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
  const { t } = useTranslation();
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [sharing, setSharing] = useState(false);

  const openShareDialog = useCallback(() => setShareDialogOpen(true), []);
  const closeShareDialog = useCallback(() => setShareDialogOpen(false), []);

  const shareProject = useCallback(async () => {
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
      const shareURL = new URL(window.location.href);
      shareURL.hash = "";
      shareURL.searchParams.delete("example");
      const created = await createShortShare(payload, t, AbortSignal.timeout(15_000));
      shareURL.searchParams.set("s", created.id);
      await navigator.clipboard.writeText(shareURL.href);
      if (activeDraftIdRef.current === draftId && projectRef.current === snapshot)
        history.replaceState(null, "", shareURL);
      onNotice(
        t("shareLinkCopiedUntil", {
          date: new Intl.DateTimeFormat(playgroundLocale, { dateStyle: "long" }).format(
            new Date(created.expiresAt),
          ),
        }),
      );
      return true;
    } catch (cause) {
      onError(cause);
      return false;
    } finally {
      setSharing(false);
    }
  }, [activeDraftIdRef, onError, onNotice, projectRef, saveDraftSnapshot, t]);

  return { shareDialogOpen, sharing, openShareDialog, closeShareDialog, shareProject };
}
