import { get, set, setMany } from "idb-keyval";
import { useCallback, useEffect, useRef, useState } from "react";
import type { EditorSettings } from "./MclEditor";
import type { ProjectFile } from "./types";

const storageKey = "mcl-playground-project-v1";
const activeDraftKey = "mcl-playground-active-draft-v1";
const draftIndexKey = "mcl-playground-drafts-v1";
const draftKeyPrefix = "mcl-playground-draft-v1:";
const draftShareKeyPrefix = "mcl-playground-draft-share-v1:";
const editorSettingsKey = "mcl-playground-editor-settings-v1";
const sharedRecoveryKey = "mcl-playground-shared-recovery-v1";
const sharedRecoveryBasePrefix = "mcl-playground-shared-recovery-base-v1:";
const sharedRecoveryPatchPrefix = "mcl-playground-shared-recovery-patch-v1:";

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
export type DraftMetadata = { id: string; name: string; updatedAt: number };
export type SharedDraftRecovery = {
  draftId: string;
  fragment: string;
  activePath: string;
};
export type SharedDraftRecoveryPatch = {
  path: string;
  start: number;
  end: number;
  insert: string;
};

function sharedRecoveryPatchKey(draftId: string, path: string) {
  return `${sharedRecoveryPatchPrefix}${draftId}:${encodeURIComponent(path)}`;
}

function sharedRecoveryBaseKey(draftId: string) {
  return `${sharedRecoveryBasePrefix}${draftId}`;
}

export function loadSharedDraftRecovery():
  | {
      metadata: SharedDraftRecovery;
      patches: SharedDraftRecoveryPatch[];
    }
  | undefined {
  try {
    const rawMetadata = sessionStorage.getItem(sharedRecoveryKey);
    if (!rawMetadata) return undefined;
    const value: unknown = JSON.parse(rawMetadata);
    if (!value || typeof value !== "object") return undefined;
    const stored = value as Record<string, unknown>;
    if (
      typeof stored.draftId !== "string" ||
      !/^[0-9a-f-]{36}$/i.test(stored.draftId) ||
      typeof stored.activePath !== "string"
    )
      return undefined;

    const fragment = sessionStorage.getItem(sharedRecoveryBaseKey(stored.draftId));
    if (!fragment?.startsWith("#project=")) return undefined;
    const metadata = {
      draftId: stored.draftId,
      fragment,
      activePath: stored.activePath,
    };
    const prefix = `${sharedRecoveryPatchPrefix}${stored.draftId}:`;
    const patches: SharedDraftRecoveryPatch[] = [];
    for (let index = 0; index < sessionStorage.length; index += 1) {
      const key = sessionStorage.key(index);
      if (!key?.startsWith(prefix)) continue;
      const patch: unknown = JSON.parse(sessionStorage.getItem(key) ?? "null");
      if (
        !patch ||
        typeof patch !== "object" ||
        typeof (patch as SharedDraftRecoveryPatch).path !== "string" ||
        !Number.isSafeInteger((patch as SharedDraftRecoveryPatch).start) ||
        !Number.isSafeInteger((patch as SharedDraftRecoveryPatch).end) ||
        typeof (patch as SharedDraftRecoveryPatch).insert !== "string"
      )
        return undefined;
      patches.push(patch as SharedDraftRecoveryPatch);
    }
    return { metadata: metadata as unknown as SharedDraftRecovery, patches };
  } catch {
    return undefined;
  }
}

export function saveSharedDraftRecovery(
  metadata: SharedDraftRecovery,
  patch?: SharedDraftRecoveryPatch,
) {
  let previousMetadata: unknown;
  try {
    previousMetadata = JSON.parse(sessionStorage.getItem(sharedRecoveryKey) ?? "null");
  } catch {
    previousMetadata = undefined;
  }
  if (
    !previousMetadata ||
    typeof previousMetadata !== "object" ||
    (previousMetadata as Record<string, unknown>).draftId !== metadata.draftId ||
    sessionStorage.getItem(sharedRecoveryBaseKey(metadata.draftId)) !== metadata.fragment
  )
    sessionStorage.setItem(sharedRecoveryBaseKey(metadata.draftId), metadata.fragment);
  if (patch)
    sessionStorage.setItem(
      sharedRecoveryPatchKey(metadata.draftId, patch.path),
      JSON.stringify(patch),
    );
  sessionStorage.setItem(
    sharedRecoveryKey,
    JSON.stringify({ draftId: metadata.draftId, activePath: metadata.activePath }),
  );
}

export function resetSharedDraftRecovery(metadata: SharedDraftRecovery) {
  const prefix = `${sharedRecoveryPatchPrefix}${metadata.draftId}:`;
  for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
    const key = sessionStorage.key(index);
    if (key?.startsWith(prefix)) sessionStorage.removeItem(key);
  }
  sessionStorage.setItem(sharedRecoveryBaseKey(metadata.draftId), metadata.fragment);
  sessionStorage.setItem(
    sharedRecoveryKey,
    JSON.stringify({ draftId: metadata.draftId, activePath: metadata.activePath }),
  );
}

export function clearSharedDraftRecovery(draftId?: string) {
  const saved = loadSharedDraftRecovery();
  if (draftId && saved && saved.metadata.draftId !== draftId) return;
  const targetDraftId = saved?.metadata.draftId ?? draftId;
  if (targetDraftId) {
    const prefix = `${sharedRecoveryPatchPrefix}${targetDraftId}:`;
    for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
      const key = sessionStorage.key(index);
      if (key?.startsWith(prefix)) sessionStorage.removeItem(key);
    }
    sessionStorage.removeItem(sharedRecoveryBaseKey(targetDraftId));
  }
  sessionStorage.removeItem(sharedRecoveryKey);
}

function draftDataKey(id: string) {
  return `${draftKeyPrefix}${id}`;
}

function draftShareKey(id: string) {
  return `${draftShareKeyPrefix}${id}`;
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
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.source !== "string" ||
    !candidate.files ||
    typeof candidate.files !== "object" ||
    Array.isArray(candidate.files) ||
    (candidate.activePath !== undefined && typeof candidate.activePath !== "string")
  )
    return false;
  return Object.values(candidate.files).every((file) => {
    if (!file || typeof file !== "object") return false;
    const candidateFile = file as Record<string, unknown>;
    return (
      (candidateFile.encoding === "utf8" && typeof candidateFile.content === "string") ||
      (candidateFile.encoding === "binary" && candidateFile.bytes instanceof Uint8Array)
    );
  });
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
  const [drafts, setDrafts] = useState<DraftMetadata[]>([]);
  const [draftsLoaded, setDraftsLoaded] = useState(false);
  const activeDraftIdRef = useRef("");
  const draftsRef = useRef<DraftMetadata[]>([]);
  const writeQueue = useRef(Promise.resolve());

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
      if (persist) void enqueueWrite(() => set(draftIndexKey, next)).catch(onError);
      return next;
    },
    [enqueueWrite, onError],
  );

  const saveDraftSnapshot = useCallback(
    async (id: string, value: StoredProject) => {
      if (!id) return;
      const index = updateDraftMetadata(id, undefined, false);
      await enqueueWrite(() =>
        setMany([
          [draftDataKey(id), value],
          [draftIndexKey, index],
        ]),
      );
    },
    [enqueueWrite, updateDraftMetadata],
  );

  useEffect(() => {
    if (!draftsLoaded || !activeDraftId) return;
    const timer = setTimeout(() => {
      void saveDraftSnapshot(activeDraftId, project).catch(onError);
    }, 300);
    return () => clearTimeout(timer);
  }, [activeDraftId, draftsLoaded, onError, project, saveDraftSnapshot]);

  const activateDraft = useCallback(
    (id: string, name?: string, shareFragment?: string) => {
      activeDraftIdRef.current = id;
      setActiveDraftId(id);
      void set(activeDraftKey, id).catch(onError);
      if (shareFragment !== undefined) void set(draftShareKey(id), shareFragment).catch(onError);
      updateDraftMetadata(id, name);
    },
    [onError, updateDraftMetadata],
  );

  const loadDraftIndex = useCallback(async () => {
    const savedIndex: unknown = await get(draftIndexKey);
    const savedDrafts = isDraftMetadataList(savedIndex) ? savedIndex : [];
    draftsRef.current = savedDrafts;
    setDrafts(savedDrafts);
    return savedDrafts;
  }, []);

  const loadActiveDraftId = useCallback(async () => {
    const value: unknown = await get(activeDraftKey);
    return typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value) ? value : "";
  }, []);

  const loadDraft = useCallback(async (id: string) => get(draftDataKey(id)), []);
  const loadLegacyProject = useCallback(async () => get(storageKey), []);
  const loadDraftShare = useCallback(async (id: string) => get(draftShareKey(id)), []);
  const markDraftsLoaded = useCallback(() => setDraftsLoaded(true), []);

  useEffect(() => {
    let cancelled = false;
    void get(editorSettingsKey)
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
    void set(editorSettingsKey, editorSettings).catch((cause: unknown) => onError(cause));
  }, [editorSettings, editorSettingsLoaded, onError]);

  const setActiveDraft = useCallback(async (id: string) => {
    activeDraftIdRef.current = id;
    setActiveDraftId(id);
    await set(activeDraftKey, id);
  }, []);

  const setDraftShare = useCallback(async (id: string, fragment: string) => {
    await set(draftShareKey(id), fragment);
  }, []);

  return {
    editorSettings,
    setEditorSettings,
    editorSettingsLoaded,
    activeDraftId,
    activeDraftIdRef,
    drafts,
    draftsRef,
    draftsLoaded,
    setActiveDraft,
    setDraftShare,
    activateDraft,
    updateDraftMetadata,
    saveDraftSnapshot,
    loadDraftIndex,
    loadActiveDraftId,
    loadDraft,
    loadLegacyProject,
    loadDraftShare,
    markDraftsLoaded,
  };
}
