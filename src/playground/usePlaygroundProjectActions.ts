import { useTranslation } from "react-i18next";
import type { PlaygroundClient } from "./types";
import type { PlaygroundProject } from "./usePlaygroundProject";
import {
  DraftConflictError,
  isStoredProject,
  usePlaygroundPersistence,
} from "./usePlaygroundPersistence";
import type { StoredProject } from "./usePlaygroundPersistence";
import { writeProjectArchive } from "./projectZip";

export type ExampleCatalogEntry = {
  category: Record<"en" | "ja", string>;
  title: Record<"en" | "ja", string>;
  slug: string;
  asset: string;
  description: Record<"en" | "ja", string>;
  tags: string[];
  difficulty: Record<"en" | "ja", string>;
  preview: string;
};

export type ExampleSpec = {
  category: string;
  title: string;
  slug: string;
  asset: string;
  description: string;
  tags: string[];
  difficulty: string;
  preview: string;
};

type ApplyProject = (
  project: StoredProject,
  options?: { newDraft?: boolean; name?: string; skipCurrentSnapshot?: boolean },
) => boolean;
type PersistenceActions = Pick<
  ReturnType<typeof usePlaygroundPersistence>,
  | "activeDraftId"
  | "activeDraftIdRef"
  | "activateDraft"
  | "clearDraftConflict"
  | "deleteDraft"
  | "draftsRef"
  | "loadDraft"
  | "saveDraftSnapshot"
  | "setActiveDraft"
>;

type Options = {
  activeDraftName: string;
  applyProject: ApplyProject;
  client: { readonly current: PlaygroundClient | undefined };
  examples: ExampleSpec[];
  initialSource: string;
  persistence: PersistenceActions;
  projectRef: { readonly current: PlaygroundProject };
  downloadBlob: (blob: Blob, filename: string) => void;
  setDeleteProjectOpen: (open: boolean) => void;
  setError: (message: string) => void;
  setExamplesOpen: (open: boolean) => void;
  setLoadingProject: (loading: boolean) => void;
  setNotice: (message: string) => void;
};

export async function loadExampleFiles(
  example: Pick<ExampleSpec, "asset">,
  messages: { loadError: string; invalidFormat: string },
): Promise<Record<string, string>> {
  const response = await fetch(example.asset, { cache: "force-cache" });
  if (!response.ok) throw new Error(messages.loadError);
  const value: unknown = await response.json();
  if (!value || typeof value !== "object" || !("files" in value))
    throw new Error(messages.invalidFormat);
  const files = (value as { files: unknown }).files;
  if (
    !files ||
    typeof files !== "object" ||
    Array.isArray(files) ||
    !Object.hasOwn(files, "main.mcl") ||
    !Object.values(files).every((content) => typeof content === "string")
  ) {
    throw new Error(messages.invalidFormat);
  }
  return files as Record<string, string>;
}

export function clearShareReferenceFromURL() {
  const url = new URL(window.location.href);
  const isShortSharePath = /^\/playground\/s\/[A-Za-z0-9_-]{22}\/?$/.test(url.pathname);
  if (!isShortSharePath) return;
  url.pathname = "/playground/";
  history.replaceState(null, "", url);
}

export function usePlaygroundProjectActions({
  activeDraftName,
  applyProject,
  client,
  examples,
  initialSource,
  persistence,
  projectRef,
  downloadBlob,
  setDeleteProjectOpen,
  setError,
  setExamplesOpen,
  setLoadingProject,
  setNotice,
}: Options) {
  const { t } = useTranslation();
  const {
    activeDraftId,
    activeDraftIdRef,
    activateDraft,
    clearDraftConflict,
    deleteDraft,
    draftsRef,
    loadDraft,
    saveDraftSnapshot,
    setActiveDraft,
  } = persistence;

  async function loadProject(files: File[]) {
    if (!client.current) throw new Error("Playground is not ready");
    return await client.current.loadProject(files);
  }

  async function selectSample(selected: string) {
    const example = examples.find((entry) => entry.slug === selected);
    if (!example) return;

    setLoadingProject(true);
    try {
      const files = await loadExampleFiles(example, {
        loadError: t("exampleLoadError", { title: example.title }),
        invalidFormat: t("exampleInvalidFormat", { title: example.title }),
      });
      const { ["main.mcl"]: source, ...otherFiles } = files;
      applyProject(
        {
          source,
          files: Object.fromEntries(
            Object.entries(otherFiles).map(([path, content]) => [
              path,
              { encoding: "utf8", content },
            ]),
          ),
        },
        { name: example.title },
      );
    } catch (cause) {
      if (cause instanceof DraftConflictError) return;
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoadingProject(false);
      setExamplesOpen(false);
    }
  }

  async function openDraft(id: string) {
    if (id === activeDraftIdRef.current) return;
    try {
      await saveDraftSnapshot(activeDraftIdRef.current, projectRef.current);
      const saved: unknown = await loadDraft(id);
      if (!isStoredProject(saved)) throw new Error(t("projectUnavailable"));
      clearDraftConflict(id);
      await setActiveDraft(id);
      clearShareReferenceFromURL();
      applyProject(saved, { newDraft: false });
    } catch (cause) {
      if (cause instanceof DraftConflictError) return;
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function reloadConflictedDraft() {
    try {
      const saved: unknown = await loadDraft(activeDraftId);
      if (!isStoredProject(saved)) throw new Error(t("projectUnavailable"));
      applyProject(saved, { newDraft: false });
      clearDraftConflict(activeDraftId);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  function createDraft() {
    applyProject({ source: initialSource, files: {} }, { name: t("defaultProjectName") });
  }

  function duplicateDraft() {
    applyProject(projectRef.current, {
      name: t("projectCopyName", { name: activeDraftName }),
    });
  }

  function deleteCurrentDraft() {
    if (activeDraftId) setDeleteProjectOpen(true);
  }

  async function confirmDeleteCurrentDraft() {
    setDeleteProjectOpen(false);
    try {
      await saveDraftSnapshot(activeDraftId, projectRef.current);
      await deleteDraft(activeDraftId);
      clearShareReferenceFromURL();
      const [nextDraft] = draftsRef.current;
      if (nextDraft) {
        const saved: unknown = await loadDraft(nextDraft.id);
        if (!isStoredProject(saved)) throw new Error(t("projectUnavailable"));
        clearDraftConflict(nextDraft.id);
        await setActiveDraft(nextDraft.id);
        applyProject(saved, { newDraft: false });
      } else {
        const nextId = crypto.randomUUID();
        activateDraft(nextId, t("defaultProjectName"));
        applyProject({ source: initialSource, files: {} }, { newDraft: false });
      }
    } catch (cause) {
      if (cause instanceof DraftConflictError) return;
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function exportProject() {
    try {
      const archive = await writeProjectArchive(
        {
          source: projectRef.current.source,
          files: projectRef.current.files,
        },
        t,
      );
      downloadBlob(archive, "mcl-project.zip");
      setNotice(t("zipExported"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  return {
    confirmDeleteCurrentDraft,
    createDraft,
    deleteCurrentDraft,
    duplicateDraft,
    exportProject,
    loadProject,
    openDraft,
    reloadConflictedDraft,
    selectSample,
  };
}
