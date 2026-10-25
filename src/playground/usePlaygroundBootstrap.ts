import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import type { EditorView } from "@codemirror/view";
import type { TFunction } from "i18next";
import { parseSharedProjectPayload } from "./projectShare";
import { loadShortShare } from "./projectShareApi";
import { loadExampleFiles } from "./usePlaygroundProjectActions";
import type { ExampleSpec } from "./usePlaygroundProjectActions";
import type { DraftMetadata, StoredProject } from "./usePlaygroundPersistence";
import { isStoredProject } from "./usePlaygroundPersistence";
import type { ProjectFile } from "./types";
import type { PlaygroundProject } from "./usePlaygroundProject";

const shortShareDraftSessionKey = "mcl-playground-short-share-draft-v1:";

type Options = {
  editor: RefObject<EditorView | undefined>;
  startupReady: RefObject<boolean>;
  runInitialProjectIfReady: () => void;
  project: RefObject<PlaygroundProject>;
  activeDraftIdRef: RefObject<string>;
  draftsRef: RefObject<DraftMetadata[]>;
  examples: ExampleSpec[];
  t: TFunction;
  loadDraftIndex: () => Promise<unknown>;
  loadActiveDraftId: () => Promise<string | undefined>;
  loadDraft: (id: string) => Promise<unknown>;
  setActiveDraft: (id: string) => Promise<void>;
  activateDraft: (id: string, name: string) => void;
  updateDraftMetadata: (id: string, name?: string) => void;
  markDraftsLoaded: () => void;
  applyProject: (project: StoredProject, options?: { newDraft?: boolean }) => boolean;
  applyWorkspacePreference: (
    files: Record<string, ProjectFile>,
    activePath: string,
    createNewDraft: boolean,
  ) => void;
  saveDraftSnapshot: (id: string, project: StoredProject) => Promise<void>;
  setPendingInitialImport: (value: { id: string; name: string } | undefined) => void;
  setError: (value: string) => void;
};

function loadShortShareDraftID(id: string): string | undefined {
  try {
    return sessionStorage.getItem(`${shortShareDraftSessionKey}${id}`) ?? undefined;
  } catch {
    return undefined;
  }
}

function saveShortShareDraftID(shareID: string, draftID: string) {
  try {
    sessionStorage.setItem(`${shortShareDraftSessionKey}${shareID}`, draftID);
  } catch {
    // Session storage may be disabled; the immutable snapshot remains available from the API.
  }
}

function sharedProjectError(cause: unknown, tooLargeMessage: string): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  return message === "Shared project is too large" ? tooLargeMessage : message;
}

export function usePlaygroundBootstrap({
  editor,
  startupReady,
  runInitialProjectIfReady,
  project,
  activeDraftIdRef,
  draftsRef,
  examples,
  t,
  loadDraftIndex,
  loadActiveDraftId,
  loadDraft,
  setActiveDraft,
  activateDraft,
  updateDraftMetadata,
  markDraftsLoaded,
  applyProject,
  applyWorkspacePreference,
  saveDraftSnapshot,
  setPendingInitialImport,
  setError,
}: Options) {
  const latest = useRef({ examples, t, applyProject, setError });
  latest.current = { examples, t, applyProject, setError };

  useEffect(() => {
    let cancelled = false;
    const startupController = new AbortController();
    void (async () => {
      let restored: StoredProject | undefined;
      let activeId = "";
      try {
        await loadDraftIndex();
        const savedActiveId = await loadActiveDraftId();
        if (savedActiveId) {
          const saved: unknown = await loadDraft(savedActiveId);
          if (isStoredProject(saved)) {
            restored = saved;
            activeId = savedActiveId;
          }
        }
        if (!activeId) activeId = crypto.randomUUID();
        else {
          await setActiveDraft(activeId);
          if (!draftsRef.current.some((draft) => draft.id === activeId))
            updateDraftMetadata(activeId, latest.current.t("defaultProjectName"));
        }
      } catch (cause) {
        if (!cancelled)
          latest.current.setError(cause instanceof Error ? cause.message : String(cause));
      }
      if (!activeId) {
        activeId = crypto.randomUUID();
        activateDraft(activeId, latest.current.t("defaultProjectName"));
      }

      const currentURL = new URL(window.location.href);
      const shortShareId = currentURL.pathname.match(
        /^\/playground\/s\/([A-Za-z0-9_-]{22})\/?$/,
      )?.[1];
      if (cancelled) return;
      if (!draftsRef.current.some((draft) => draft.id === activeId))
        activateDraft(activeId, latest.current.t("defaultProjectName"));
      if (restored) latest.current.applyProject(restored, { newDraft: false });
      else applyWorkspacePreference(project.current.files, project.current.activePath, false);
      startupReady.current = true;
      if (editor.current) editor.current.contentDOM.contentEditable = "true";
      markDraftsLoaded();
      runInitialProjectIfReady();

      const baseRevision = project.current.revision;
      const baseDraftId = activeDraftIdRef.current;
      void (async () => {
        try {
          let imported: StoredProject | undefined;
          let importedDraftId: string | undefined;
          let importedName = "";
          let exampleSlug: string | undefined;

          if (shortShareId) {
            importedName = latest.current.t("sharedProjectName");
            const sessionDraftId = loadShortShareDraftID(shortShareId);
            const sessionDraft: unknown = sessionDraftId
              ? await loadDraft(sessionDraftId)
              : undefined;
            if (cancelled) return;
            if (sessionDraftId && isStoredProject(sessionDraft)) {
              imported = sessionDraft;
              importedDraftId = sessionDraftId;
            } else {
              imported = parseSharedProjectPayload(
                await loadShortShare(
                  shortShareId,
                  t,
                  AbortSignal.any([startupController.signal, AbortSignal.timeout(15_000)]),
                ),
              );
            }
          } else {
            const url = new URL(window.location.href);
            exampleSlug = url.searchParams.get("example") ?? undefined;
            const example = latest.current.examples.find((entry) => entry.slug === exampleSlug);
            if (example) {
              importedName = example.title;
              const files = await loadExampleFiles(example, {
                loadError: latest.current.t("exampleLoadError", { title: example.title }),
                invalidFormat: latest.current.t("exampleInvalidFormat", {
                  title: example.title,
                }),
              });
              const { ["main.mcl"]: source, ...otherFiles } = files;
              imported = {
                source,
                files: Object.fromEntries(
                  Object.entries(otherFiles).map(([path, content]) => [
                    path,
                    { encoding: "utf8", content },
                  ]),
                ),
              };
            }
          }

          if (cancelled || !imported) return;
          const projectChanged =
            project.current.revision !== baseRevision || activeDraftIdRef.current !== baseDraftId;
          if (!projectChanged) {
            const targetDraftId = importedDraftId ?? crypto.randomUUID();
            activateDraft(targetDraftId, importedName);
            if (importedDraftId && !draftsRef.current.some((draft) => draft.id === targetDraftId))
              updateDraftMetadata(targetDraftId, importedName);
            if (!latest.current.applyProject(imported, { newDraft: false })) return;
            if (shortShareId) {
              await saveDraftSnapshot(targetDraftId, project.current);
              saveShortShareDraftID(shortShareId, targetDraftId);
            }
          } else if (importedDraftId) {
            if (importedDraftId === activeDraftIdRef.current) return;
            if (!draftsRef.current.some((draft) => draft.id === importedDraftId))
              updateDraftMetadata(importedDraftId, importedName);
            setPendingInitialImport({ id: importedDraftId, name: importedName });
          } else {
            const draftId = crypto.randomUUID();
            updateDraftMetadata(draftId, importedName);
            await saveDraftSnapshot(draftId, imported);
            if (cancelled) return;
            if (shortShareId) saveShortShareDraftID(shortShareId, draftId);
            setPendingInitialImport({ id: draftId, name: importedName });
          }

          if (exampleSlug) {
            const url = new URL(window.location.href);
            url.searchParams.delete("example");
            history.replaceState(null, "", url);
          }
        } catch (cause) {
          if (cancelled) return;
          latest.current.setError(
            shortShareId
              ? sharedProjectError(cause, latest.current.t("sharedProjectTooLarge"))
              : cause instanceof Error
                ? cause.message
                : String(cause),
          );
        }
      })();
    })();

    return () => {
      cancelled = true;
      startupController.abort();
    };
  }, [
    activateDraft,
    activeDraftIdRef,
    applyWorkspacePreference,
    loadActiveDraftId,
    loadDraft,
    loadDraftIndex,
    markDraftsLoaded,
    project,
    runInitialProjectIfReady,
    saveDraftSnapshot,
    setActiveDraft,
    updateDraftMetadata,
  ]);
}
