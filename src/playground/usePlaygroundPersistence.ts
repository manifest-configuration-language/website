import { useCallback, useEffect, useRef, useState } from "react";
import type { EditorSettings } from "./MclEditor";
import { isValidProjectSnapshot } from "./projectValidation.js";
import {
  ensurePlaygroundStorageMigrated,
  playgroundDatabase,
  playgroundSettingKeys,
} from "./playgroundDatabase";
import type { ProjectFile } from "./types";

export const defaultEditorSettings: EditorSettings = {
  theme: "system",
  tabSize: 2,
  fontSize: 14,
  lineWrapping: false,
  lineNumbers: true,
  vim: false,
};

export type StoredProject = {
  source: string;
  files: Record<string, ProjectFile>;
  activePath?: string;
};
export type DraftSaveStatus = "saving" | "saved" | "error";
export type DraftMetadata = { id: string; name: string; updatedAt: number };
function isDraftMetadataList(value: unknown): value is DraftMetadata[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        item !== null &&
        typeof item === "object" &&
        typeof (item as DraftMetadata).id === "string" &&
        typeof (item as DraftMetadata).name === "string" &&
        typeof (item as DraftMetadata).updatedAt === "number",
    )
  );
}

export function isStoredProject(value: unknown): value is StoredProject {
  return isValidProjectSnapshot(value);
}

function isEditorSettings(value: unknown): value is Omit<EditorSettings, "fontSize" | "theme"> & {
  fontSize?: EditorSettings["fontSize"];
  theme?: EditorSettings["theme"];
} {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    (candidate.theme === undefined ||
      candidate.theme === "system" ||
      candidate.theme === "light" ||
      candidate.theme === "dark") &&
    (candidate.tabSize === 2 || candidate.tabSize === 4) &&
    (candidate.fontSize === undefined ||
      [12, 14, 16, 18, 20].includes(candidate.fontSize as number)) &&
    typeof candidate.lineWrapping === "boolean" &&
    typeof candidate.lineNumbers === "boolean" &&
    typeof candidate.vim === "boolean"
  );
}

export function usePlaygroundPersistence(
  project: StoredProject,
  onError: (error: unknown) => void,
) {
  const [editorSettings, setEditorSettings] = useState<EditorSettings>(defaultEditorSettings);
  const [editorSettingsLoaded, setEditorSettingsLoaded] = useState(false);
  const [activeDraftId, setActiveDraftId] = useState("");
  const [saveStatus, setSaveStatus] = useState<DraftSaveStatus>("saved");
  const [drafts, setDrafts] = useState<DraftMetadata[]>([]);
  const [draftsLoaded, setDraftsLoaded] = useState(false);
  const activeDraftIdRef = useRef("");
  const draftsRef = useRef<DraftMetadata[]>([]);
  const writeQueue = useRef(Promise.resolve());
  const saveSequence = useRef(0);

  const enqueueWrite = useCallback((write: () => Promise<void>) => {
    const next = writeQueue.current.then(write, write);
    writeQueue.current = next.catch(() => undefined);
    return next;
  }, []);

  const updateDraftMetadata = useCallback(
    (id: string, name?: string, persist = true) => {
      const previous = draftsRef.current.find((draft) => draft.id === id);
      const nextDraft = {
        id,
        name: name ?? previous?.name ?? "プロジェクト",
        updatedAt: Date.now(),
      };
      const next = [nextDraft, ...draftsRef.current.filter((draft) => draft.id !== id)];
      draftsRef.current = next;
      setDrafts(next);
      if (persist)
        void enqueueWrite(async () => {
          await ensurePlaygroundStorageMigrated();
          await playgroundDatabase.transaction("rw", playgroundDatabase.drafts, async () => {
            const current = await playgroundDatabase.drafts.get(id);
            await playgroundDatabase.drafts.put({ ...current, ...nextDraft });
          });
        }).catch(onError);
      return next;
    },
    [enqueueWrite, onError],
  );

  const saveDraftSnapshot = useCallback(
    async (id: string, value: StoredProject) => {
      if (!id) return;
      const sequence = ++saveSequence.current;
      setSaveStatus("saving");
      const [draft] = updateDraftMetadata(id, undefined, false);
      if (!draft) return;
      try {
        await enqueueWrite(async () => {
          await ensurePlaygroundStorageMigrated();
          await playgroundDatabase.transaction(
            "rw",
            playgroundDatabase.drafts,
            playgroundDatabase.projects,
            async () => {
              const current = await playgroundDatabase.drafts.get(id);
              await playgroundDatabase.drafts.put({ ...current, ...draft });
              await playgroundDatabase.projects.put({ id, project: value });
            },
          );
        });
        if (sequence === saveSequence.current) setSaveStatus("saved");
      } catch (cause) {
        if (sequence === saveSequence.current) setSaveStatus("error");
        throw cause;
      }
    },
    [enqueueWrite, updateDraftMetadata],
  );

  useEffect(() => {
    if (!draftsLoaded || !activeDraftId) return;
    ++saveSequence.current;
    setSaveStatus("saving");
    const timer = setTimeout(() => {
      void saveDraftSnapshot(activeDraftId, project).catch((cause: unknown) => onError(cause));
    }, 300);
    return () => clearTimeout(timer);
  }, [activeDraftId, draftsLoaded, onError, project, saveDraftSnapshot]);

  const setActiveDraft = useCallback(async (id: string) => {
    activeDraftIdRef.current = id;
    setActiveDraftId(id);
    await ensurePlaygroundStorageMigrated();
    await playgroundDatabase.settings.put({ key: playgroundSettingKeys.activeDraft, value: id });
  }, []);

  const activateDraft = useCallback(
    (id: string, name?: string) => {
      void setActiveDraft(id).catch(onError);
      updateDraftMetadata(id, name);
    },
    [onError, setActiveDraft, updateDraftMetadata],
  );

  const loadDraftIndex = useCallback(async () => {
    await ensurePlaygroundStorageMigrated();
    const savedIndex = (
      await playgroundDatabase.drafts.orderBy("updatedAt").reverse().toArray()
    ).map(({ id, name, updatedAt }) => ({ id, name, updatedAt }));
    const savedDrafts = isDraftMetadataList(savedIndex) ? savedIndex : [];
    draftsRef.current = savedDrafts;
    setDrafts(savedDrafts);
    return savedDrafts;
  }, []);

  const loadActiveDraftId = useCallback(async () => {
    await ensurePlaygroundStorageMigrated();
    const value: unknown = (
      await playgroundDatabase.settings.get(playgroundSettingKeys.activeDraft)
    )?.value;
    return typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value) ? value : "";
  }, []);

  const loadDraft = useCallback(async (id: string) => {
    await ensurePlaygroundStorageMigrated();
    return (await playgroundDatabase.projects.get(id))?.project;
  }, []);
  const deleteDraft = useCallback(
    async (id: string) => {
      await enqueueWrite(async () => {
        await ensurePlaygroundStorageMigrated();
        await playgroundDatabase.transaction(
          "rw",
          playgroundDatabase.drafts,
          playgroundDatabase.projects,
          async () => {
            await playgroundDatabase.drafts.delete(id);
            await playgroundDatabase.projects.delete(id);
          },
        );
      });
      const next = draftsRef.current.filter((draft) => draft.id !== id);
      draftsRef.current = next;
      setDrafts(next);
    },
    [enqueueWrite],
  );
  const loadLegacyProject = useCallback(async () => {
    await ensurePlaygroundStorageMigrated();
    return (await playgroundDatabase.settings.get(playgroundSettingKeys.legacyProject))?.value;
  }, []);
  const markDraftsLoaded = useCallback(() => setDraftsLoaded(true), []);

  useEffect(() => {
    let cancelled = false;
    void ensurePlaygroundStorageMigrated()
      .then(() => playgroundDatabase.settings.get(playgroundSettingKeys.editorSettings))
      .then((record) => record?.value)
      .then((saved: unknown) => {
        if (!cancelled && isEditorSettings(saved))
          setEditorSettings({
            ...saved,
            theme: saved.theme ?? defaultEditorSettings.theme,
            fontSize: saved.fontSize ?? defaultEditorSettings.fontSize,
          });
      })
      .catch((cause: unknown) => {
        if (!cancelled) onError(cause);
      })
      .finally(() => {
        if (!cancelled) setEditorSettingsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [onError]);

  useEffect(() => {
    if (!editorSettingsLoaded) return;
    void ensurePlaygroundStorageMigrated()
      .then(() =>
        playgroundDatabase.settings.put({
          key: playgroundSettingKeys.editorSettings,
          value: editorSettings,
        }),
      )
      .catch((cause: unknown) => onError(cause));
  }, [editorSettings, editorSettingsLoaded, onError]);

  return {
    editorSettings,
    saveStatus,
    setEditorSettings,
    editorSettingsLoaded,
    activeDraftId,
    activeDraftIdRef,
    drafts,
    draftsRef,
    draftsLoaded,
    setActiveDraft,
    activateDraft,
    updateDraftMetadata,
    saveDraftSnapshot,
    loadDraftIndex,
    loadActiveDraftId,
    loadDraft,
    deleteDraft,
    loadLegacyProject,
    markDraftsLoaded,
  };
}
