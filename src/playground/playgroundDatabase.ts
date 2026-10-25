import Dexie, { type Table } from "dexie";

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

export type PlaygroundSettingRecord = {
  key: string;
  value: unknown;
};

export const playgroundSettingKeys = {
  activeDraft: "active-draft",
  editorSettings: "editor-settings",
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
