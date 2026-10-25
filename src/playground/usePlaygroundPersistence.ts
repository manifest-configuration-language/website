import { useCallback, useEffect, useRef, useState } from "react";
import type { EditorSettings } from "./MclEditor";
import { isValidProjectSnapshot } from "./projectValidation.js";
import { playgroundDatabase, playgroundSettingKeys } from "./playgroundDatabase";
import type { ProjectFile } from "./types";
import { defaultPlaygroundShortcuts, isPlaygroundShortcuts } from "./keyboardShortcuts";

export const defaultEditorSettings: EditorSettings = {
  theme: "system",
  tabSize: 2,
  fontSize: 14,
  lineWrapping: false,
  lineNumbers: true,
  vim: false,
  shortcuts: defaultPlaygroundShortcuts,
};

export type StoredProject = {
  source: string;
  files: Record<string, ProjectFile>;
  activePath?: string;
};
type ProjectRef = { current: StoredProject };
type SubscribeToProject = (listener: () => void) => () => void;
export type DraftSaveStatus = "saving" | "saved" | "error" | "conflict";
export type DraftMetadata = { id: string; name: string; updatedAt: number };

export class DraftConflictError extends Error {
  constructor(
    readonly draftId: string,
    readonly expectedRevision: number,
    readonly actualRevision: number | undefined,
  ) {
    super("The draft changed in another tab.");
    this.name = "DraftConflictError";
  }
}
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

function isEditorSettings(value: unknown): value is Omit<
  EditorSettings,
  "fontSize" | "theme" | "shortcuts"
> & {
  fontSize?: EditorSettings["fontSize"];
  theme?: EditorSettings["theme"];
  shortcuts?: EditorSettings["shortcuts"];
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
    (candidate.shortcuts === undefined || isPlaygroundShortcuts(candidate.shortcuts)) &&
    typeof candidate.lineWrapping === "boolean" &&
    typeof candidate.lineNumbers === "boolean" &&
    typeof candidate.vim === "boolean"
  );
}

export function usePlaygroundPersistence(
  projectRef: ProjectRef,
  subscribeToProject: SubscribeToProject,
  onError: (error: unknown) => void,
) {
  const [editorSettings, setEditorSettings] = useState<EditorSettings>(defaultEditorSettings);
  const [editorSettingsLoaded, setEditorSettingsLoaded] = useState(false);
  const [activeDraftId, setActiveDraftId] = useState("");
  const [saveStatus, setSaveStatus] = useState<DraftSaveStatus>("saved");
  const [conflictedDraftIds, setConflictedDraftIds] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<DraftMetadata[]>([]);
  const [draftsLoaded, setDraftsLoaded] = useState(false);
  const activeDraftIdRef = useRef("");
  const draftsRef = useRef<DraftMetadata[]>([]);
  const writeQueue = useRef(Promise.resolve());
  const saveSequence = useRef(0);
  const expectedRevisions = useRef(new Map<string, number>());
  const conflictedDraftIdsRef = useRef(new Set<string>());
  const channel = useRef<BroadcastChannel | undefined>(undefined);
  const loadDraftIndexRef = useRef<(() => Promise<DraftMetadata[]>) | undefined>(undefined);

  const enqueueWrite = useCallback((write: () => Promise<void>) => {
    const next = writeQueue.current.then(write, write);
    writeQueue.current = next.catch(() => undefined);
    return next;
  }, []);

  const markDraftConflict = useCallback((id: string) => {
    conflictedDraftIdsRef.current.add(id);
    setConflictedDraftIds([...conflictedDraftIdsRef.current]);
    if (id === activeDraftIdRef.current) {
      ++saveSequence.current;
      setSaveStatus("conflict");
    }
  }, []);

  const clearDraftConflict = useCallback((id: string) => {
    conflictedDraftIdsRef.current.delete(id);
    setConflictedDraftIds([...conflictedDraftIdsRef.current]);
    if (id === activeDraftIdRef.current) setSaveStatus("saved");
  }, []);

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const draftChannel = new BroadcastChannel("mcl-playground-drafts-v1");
    channel.current = draftChannel;
    draftChannel.addEventListener("message", (event: MessageEvent<unknown>) => {
      const message = event.data as {
        type?: unknown;
        draftId?: unknown;
        revision?: unknown;
      };
      if (
        (message?.type !== "draft-created" &&
          message?.type !== "draft-saved" &&
          message?.type !== "draft-updated" &&
          message?.type !== "draft-deleted") ||
        typeof message.draftId !== "string" ||
        typeof message.revision !== "number" ||
        !Number.isSafeInteger(message.revision) ||
        message.revision < 0
      )
        return;
      const expected = expectedRevisions.current.get(message.draftId);
      if (
        message.draftId === activeDraftIdRef.current &&
        expected !== undefined &&
        message.revision > expected
      )
        markDraftConflict(message.draftId);
      if (message.type === "draft-deleted")
        expectedRevisions.current.set(message.draftId, message.revision);
      void loadDraftIndexRef.current?.().catch(onError);
    });
    return () => {
      channel.current = undefined;
      draftChannel.close();
    };
  }, [markDraftConflict, onError]);

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
          const nextRevision = await playgroundDatabase.transaction(
            "rw",
            playgroundDatabase.drafts,
            async () => {
              const current = await playgroundDatabase.drafts.get(id);
              const hasExpectedRevision = expectedRevisions.current.has(id);
              const expectedRevision = expectedRevisions.current.get(id) ?? 0;
              if (
                (current && (!hasExpectedRevision || current.revision !== expectedRevision)) ||
                (!current && hasExpectedRevision)
              )
                throw new DraftConflictError(id, expectedRevision, current?.revision);
              const revision = expectedRevision + 1;
              await playgroundDatabase.drafts.put({
                id,
                name: nextDraft.name,
                updatedAt: nextDraft.updatedAt,
                revision,
              });
              return { revision, created: !current };
            },
          );
          expectedRevisions.current.set(id, nextRevision.revision);
          channel.current?.postMessage({
            type: nextRevision.created ? "draft-created" : "draft-updated",
            draftId: id,
            revision: nextRevision.revision,
          });
        }).catch((cause: unknown) => {
          if (cause instanceof DraftConflictError) {
            markDraftConflict(id);
            void loadDraftIndexRef.current?.().catch(onError);
          }
          onError(cause);
        });
      return next;
    },
    [enqueueWrite, markDraftConflict, onError],
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
          let nextRevision = 0;
          await playgroundDatabase.transaction(
            "rw",
            playgroundDatabase.drafts,
            playgroundDatabase.projects,
            async () => {
              const current = await playgroundDatabase.drafts.get(id);
              const expectedRevision = expectedRevisions.current.get(id) ?? 0;
              const actualRevision = current?.revision ?? 0;
              if (
                actualRevision !== expectedRevision ||
                (!current && expectedRevisions.current.has(id))
              )
                throw new DraftConflictError(id, expectedRevision, current?.revision);
              nextRevision = expectedRevision + 1;
              await playgroundDatabase.drafts.put({
                id,
                name: current?.name ?? draft.name,
                updatedAt: draft.updatedAt,
                revision: nextRevision,
              });
              await playgroundDatabase.projects.put({ id, project: value });
            },
          );
          expectedRevisions.current.set(id, nextRevision);
          channel.current?.postMessage({
            type: "draft-saved",
            draftId: id,
            revision: nextRevision,
          });
        });
        if (sequence === saveSequence.current) setSaveStatus("saved");
      } catch (cause) {
        if (cause instanceof DraftConflictError) markDraftConflict(id);
        if (sequence === saveSequence.current) setSaveStatus("error");
        throw cause;
      }
    },
    [enqueueWrite, markDraftConflict, updateDraftMetadata],
  );

  useEffect(() => {
    if (!draftsLoaded || !activeDraftId || conflictedDraftIds.includes(activeDraftId)) return;
    ++saveSequence.current;
    setSaveStatus("saving");
    let timer: ReturnType<typeof setTimeout> | undefined;
    const save = () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => {
        void saveDraftSnapshot(activeDraftId, projectRef.current).catch((cause: unknown) =>
          onError(cause),
        );
      }, 300);
    };
    const unsubscribe = subscribeToProject(save);
    save();
    return () => {
      unsubscribe();
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [
    activeDraftId,
    conflictedDraftIds,
    draftsLoaded,
    onError,
    projectRef,
    saveDraftSnapshot,
    subscribeToProject,
  ]);

  const setActiveDraft = useCallback(async (id: string) => {
    activeDraftIdRef.current = id;
    setActiveDraftId(id);
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
    const savedIndex = (
      await playgroundDatabase.drafts.orderBy("updatedAt").reverse().toArray()
    ).map(({ id, name, updatedAt }) => ({ id, name, updatedAt }));
    const savedDrafts = isDraftMetadataList(savedIndex) ? savedIndex : [];
    draftsRef.current = savedDrafts;
    setDrafts(savedDrafts);
    return savedDrafts;
  }, []);

  const loadActiveDraftId = useCallback(async () => {
    const value: unknown = (
      await playgroundDatabase.settings.get(playgroundSettingKeys.activeDraft)
    )?.value;
    return typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value) ? value : "";
  }, []);

  const loadDraft = useCallback(async (id: string) => {
    return playgroundDatabase.transaction(
      "r",
      playgroundDatabase.drafts,
      playgroundDatabase.projects,
      async () => {
        const [draft, record] = await Promise.all([
          playgroundDatabase.drafts.get(id),
          playgroundDatabase.projects.get(id),
        ]);
        expectedRevisions.current.set(id, draft?.revision ?? 0);
        return record?.project;
      },
    );
  }, []);
  const deleteDraft = useCallback(
    async (id: string) => {
      try {
        await enqueueWrite(async () => {
          const deletedRevision = await playgroundDatabase.transaction(
            "rw",
            playgroundDatabase.drafts,
            playgroundDatabase.projects,
            async () => {
              const current = await playgroundDatabase.drafts.get(id);
              const hasExpectedRevision = expectedRevisions.current.has(id);
              const expectedRevision = expectedRevisions.current.get(id) ?? 0;
              if (
                (current && (!hasExpectedRevision || current.revision !== expectedRevision)) ||
                (!current && hasExpectedRevision)
              )
                throw new DraftConflictError(id, expectedRevision, current?.revision);
              await playgroundDatabase.drafts.delete(id);
              await playgroundDatabase.projects.delete(id);
              return expectedRevision + 1;
            },
          );
          expectedRevisions.current.set(id, deletedRevision);
          channel.current?.postMessage({
            type: "draft-deleted",
            draftId: id,
            revision: deletedRevision,
          });
        });
      } catch (cause) {
        if (cause instanceof DraftConflictError) {
          markDraftConflict(id);
          void loadDraftIndexRef.current?.().catch(onError);
        }
        throw cause;
      }
      const next = draftsRef.current.filter((draft) => draft.id !== id);
      draftsRef.current = next;
      setDrafts(next);
    },
    [enqueueWrite, markDraftConflict, onError],
  );
  const markDraftsLoaded = useCallback(() => setDraftsLoaded(true), []);

  loadDraftIndexRef.current = loadDraftIndex;

  useEffect(() => {
    let cancelled = false;
    void playgroundDatabase.settings
      .get(playgroundSettingKeys.editorSettings)
      .then((record) => record?.value)
      .then((saved: unknown) => {
        if (!cancelled && isEditorSettings(saved))
          setEditorSettings({
            ...saved,
            theme: saved.theme ?? defaultEditorSettings.theme,
            fontSize: saved.fontSize ?? defaultEditorSettings.fontSize,
            shortcuts: saved.shortcuts ?? defaultEditorSettings.shortcuts,
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
    void playgroundDatabase.settings
      .put({
        key: playgroundSettingKeys.editorSettings,
        value: editorSettings,
      })
      .catch((cause: unknown) => onError(cause));
  }, [editorSettings, editorSettingsLoaded, onError]);

  return {
    editorSettings,
    saveStatus,
    conflictedDraftIds,
    clearDraftConflict,
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
    markDraftsLoaded,
  };
}
