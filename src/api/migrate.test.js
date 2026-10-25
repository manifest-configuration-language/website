import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { verifyAppliedMigrations } from "./migrate.js";

const migration = { version: "0001_create_playground_snippets.sql", checksum: "a".repeat(64) };

describe("verifyAppliedMigrations", () => {
  it("accepts matching checksums padded by PostgreSQL char fields", () => {
    assert.doesNotThrow(() =>
      verifyAppliedMigrations(
        [migration],
        [{ version: migration.version, checksum: `${migration.checksum} ` }],
      ),
    );
  });

  it("rejects a changed applied migration", () => {
    assert.throws(
      () =>
        verifyAppliedMigrations(
          [migration],
          [{ version: migration.version, checksum: "b".repeat(64) }],
        ),
      { message: `Applied database migration was modified: ${migration.version}` },
    );
  });

  it("rejects a migration version unknown to the current source", () => {
    assert.throws(
      () => verifyAppliedMigrations([migration], [{ version: "9999_orphaned.sql", checksum: "c" }]),
      { message: "Database has unknown migrations: 9999_orphaned.sql" },
    );
  });
});
