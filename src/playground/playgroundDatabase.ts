import Dexie, { type Table } from "dexie";
import { get } from "idb-keyval";

export type PlaygroundDraftRecord = {
  id: string;
  name: string;
  updatedAt: number;
  revision: number;
};

export type PlaygroundProjectRecord = {
  id: string;
  project: unknown;
};

type LegacyDraftImport = {
  draft: PlaygroundDraftRecord;
  project?: PlaygroundProjectRecord;
};

export type PlaygroundSettingRecord = {
  key: string;
  value: unknown;
};

const legacyStorageKey = "mcl-playground-project-v1";
const legacyActiveDraftKey = "mcl-playground-active-draft-v1";
const legacyDraftIndexKey = "mcl-playground-drafts-v1";
const legacyDraftKeyPrefix = "mcl-playground-draft-v1:";
const legacyEditorSettingsKey = "mcl-playground-editor-settings-v1";
const migrationSettingKey = "migration:idb-keyval-v1";

export const playgroundSettingKeys = {
  activeDraft: "active-draft",
  editorSettings: "editor-settings",
  legacyProject: "legacy-project",
} as const;

export class PlaygroundDatabase extends Dexie {
  drafts!: Table<PlaygroundDraftRecord, string>;
  projects!: Table<PlaygroundProjectRecord, string>;
  settings!: Table<PlaygroundSettingRecord, string>;

  constructor() {
    super("mcl-playground");
    this.version(1).stores({
      drafts: "id, updatedAt, name",
      projects: "id",
      settings: "key",
    });
    this.version(2)
      .stores({
        drafts: "id, updatedAt, name",
        projects: "id",
        settings: "key",
      })
      .upgrade(async (transaction) => {
        await transaction
          .table<PlaygroundDraftRecord, string>("drafts")
          .toCollection()
          .modify((draft) => {
            draft.revision ??= 0;
          });
      });
  }
}

export const playgroundDatabase = new PlaygroundDatabase();

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isDraftMetadata(value: unknown): value is {
  id: string;
  name: string;
  updatedAt: number;
  revision?: number;
} {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.updatedAt === "number" &&
    Number.isFinite(value.updatedAt) &&
    (value.revision === undefined ||
      (typeof value.revision === "number" &&
        Number.isInteger(value.revision) &&
        value.revision >= 0))
  );
}

function isDraftID(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value);
}

function legacyDraftKey(id: string) {
  return `${legacyDraftKeyPrefix}${id}`;
}

async function readLegacyDraft(metadata: {
  id: string;
  name: string;
  updatedAt: number;
}): Promise<LegacyDraftImport> {
  const project = await get(legacyDraftKey(metadata.id));
  return {
    draft: { ...metadata, revision: 0 },
    ...(project === undefined ? {} : { project: { id: metadata.id, project } }),
  };
}

async function migrateLegacyStorage() {
  const [legacyProject, activeDraft, draftIndex, editorSettings] = await Promise.all([
    get(legacyStorageKey),
    get(legacyActiveDraftKey),
    get(legacyDraftIndexKey),
    get(legacyEditorSettingsKey),
  ]);

  const metadata = Array.isArray(draftIndex) ? draftIndex.filter(isDraftMetadata) : [];
  const importedDrafts = await Promise.all(metadata.map(readLegacyDraft));
  const knownDrafts = new Set(importedDrafts.map(({ draft }) => draft.id));
  if (isDraftID(activeDraft) && !knownDrafts.has(activeDraft)) {
    const activeMetadata = {
      id: activeDraft,
      name: "プロジェクト",
      updatedAt: Date.now(),
      revision: 0,
    };
    importedDrafts.push(await readLegacyDraft(activeMetadata));
  }
  const migratedDrafts = importedDrafts.map(({ draft }) => ({ ...draft, revision: 0 }));
  const migratedProjects = importedDrafts.flatMap(({ project }) => (project ? [project] : []));

  const settings: PlaygroundSettingRecord[] = [];
  if (isDraftID(activeDraft))
    settings.push({ key: playgroundSettingKeys.activeDraft, value: activeDraft });
  if (legacyProject !== undefined)
    settings.push({ key: playgroundSettingKeys.legacyProject, value: legacyProject });
  if (editorSettings !== undefined)
    settings.push({ key: playgroundSettingKeys.editorSettings, value: editorSettings });
  settings.push({ key: migrationSettingKey, value: true });

  await playgroundDatabase.transaction(
    "rw",
    playgroundDatabase.drafts,
    playgroundDatabase.projects,
    playgroundDatabase.settings,
    async () => {
      if ((await playgroundDatabase.settings.get(migrationSettingKey))?.value === true) return;
      if (migratedDrafts.length > 0) await playgroundDatabase.drafts.bulkPut(migratedDrafts);
      if (migratedProjects.length > 0) await playgroundDatabase.projects.bulkPut(migratedProjects);
      await playgroundDatabase.settings.bulkPut(settings);
    },
  );
}

let migration: Promise<void> | undefined;

export function ensurePlaygroundStorageMigrated() {
  migration ??= migrateLegacyStorage().catch((cause: unknown) => {
    migration = undefined;
    throw cause;
  });
  return migration;
}
