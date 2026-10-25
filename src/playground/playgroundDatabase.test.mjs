import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import { it } from "node:test";

const { default: Dexie } = await import("dexie");
const { PlaygroundDatabase } = await import("./playgroundDatabase.ts");

function deleteDatabase(name) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = resolve;
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error(`Database deletion was blocked: ${name}`));
  });
}

it("adds revision metadata while preserving existing drafts and project data", async () => {
  const legacy = new Dexie("mcl-playground");
  legacy.version(1).stores({
    drafts: "id, updatedAt, name",
    projects: "id",
    settings: "key",
  });

  await deleteDatabase("mcl-playground");
  try {
    await legacy.open();
    await legacy.table("drafts").bulkPut([
      { id: "legacy", name: "Legacy", updatedAt: 1 },
      { id: "revisioned", name: "Revisioned", updatedAt: 2, revision: 4 },
    ]);
    await legacy.table("projects").put({ id: "legacy", project: { source: "emit 1" } });
    await legacy.table("settings").put({ key: "active-draft", value: "legacy" });
  } finally {
    legacy.close();
  }

  const database = new PlaygroundDatabase();
  try {
    await database.open();

    assert.deepEqual(await database.drafts.orderBy("id").toArray(), [
      { id: "legacy", name: "Legacy", updatedAt: 1, revision: 0 },
      { id: "revisioned", name: "Revisioned", updatedAt: 2, revision: 4 },
    ]);
    assert.deepEqual(await database.projects.get("legacy"), {
      id: "legacy",
      project: { source: "emit 1" },
    });
    assert.deepEqual(await database.settings.get("active-draft"), {
      key: "active-draft",
      value: "legacy",
    });
  } finally {
    database.close();
    await deleteDatabase("mcl-playground");
  }
});
