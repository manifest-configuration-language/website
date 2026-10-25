import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { playgroundLocale } from "./playgroundI18n";
import type { StoredProject } from "./usePlaygroundPersistence";
import { createProjectFragmentURL, createSharedProjectPayload } from "./projectShare";
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
  const [shareURL, setShareURL] = useState("");
  const [shareError, setShareError] = useState("");

  const openShareDialog = useCallback(() => {
    setShareURL("");
    setShareError("");
    setShareDialogOpen(true);
  }, []);
  const closeShareDialog = useCallback(() => setShareDialogOpen(false), []);

  const shareProject = useCallback(async () => {
    if (shareURL) {
      try {
        await navigator.clipboard.writeText(shareURL);
        onNotice(t("shareLinkCopied"));
      } catch {
        onNotice(t("shareCopyFailed"));
        return false;
      }
      return true;
    }
    setSharing(true);
    setShareError("");
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
      let expiresAt: string | undefined;
      let usedFragment = false;
      try {
        const created = await createShortShare(payload, t, AbortSignal.timeout(15_000));
        shareURL.pathname = `/playground/s/${created.id}`;
        shareURL.searchParams.delete("s");
        expiresAt = created.expiresAt;
      } catch {
        try {
          const fallbackURL = await createProjectFragmentURL(payload, shareURL);
          shareURL.href = fallbackURL.href;
          usedFragment = true;
        } catch (cause) {
          setShareError(
            cause instanceof Error && cause.message === "Shared project is too large for a URL link"
              ? t("shareFallbackTooLarge")
              : t("shareLinkGenerationFailed"),
          );
          return false;
        }
      }
      setShareURL(shareURL.href);
      if (activeDraftIdRef.current === draftId && projectRef.current === snapshot)
        history.replaceState(null, "", shareURL);
      try {
        await navigator.clipboard.writeText(shareURL.href);
        onNotice(
          expiresAt
            ? t("shareLinkCopiedUntil", {
                date: new Intl.DateTimeFormat(playgroundLocale, { dateStyle: "long" }).format(
                  new Date(expiresAt),
                ),
              })
            : t(usedFragment ? "shareLinkFragment" : "shareLinkCopied"),
        );
      } catch {
        onNotice(t("shareCopyFailed"));
      }
      return true;
    } catch (cause) {
      onError(cause);
      return false;
    } finally {
      setSharing(false);
    }
  }, [activeDraftIdRef, onError, onNotice, projectRef, saveDraftSnapshot, shareURL, t]);

  return {
    shareDialogOpen,
    sharing,
    shareURL,
    shareError,
    openShareDialog,
    closeShareDialog,
    shareProject,
  };
}
