import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const migrationDirectory = new URL("./migrations/", import.meta.url);
const migrationLockKey = 741_203_809;

async function loadMigrations() {
  const names = (await readdir(migrationDirectory)).filter((name) => name.endsWith(".sql")).sort();
  return Promise.all(
    names.map(async (version) => {
      const sql = await readFile(new URL(version, migrationDirectory), "utf8");
      return {
        version,
        sql,
        checksum: createHash("sha256").update(sql).digest("hex"),
      };
    }),
  );
}

function verifyAppliedMigrations(migrations, applied) {
  const byVersion = new Map(applied.map((entry) => [entry.version, entry.checksum.trim()]));
  for (const migration of migrations) {
    const checksum = byVersion.get(migration.version);
    if (checksum !== undefined && checksum !== migration.checksum)
      throw new Error(`Applied database migration was modified: ${migration.version}`);
    byVersion.delete(migration.version);
  }
  if (byVersion.size > 0)
    throw new Error(`Database has unknown migrations: ${[...byVersion.keys()].join(", ")}`);
}

export async function verifyDatabaseMigrations(database) {
  const migrations = await loadMigrations();
  const applied = await database`
    SELECT version, checksum FROM playground_schema_migrations ORDER BY version
  `;
  verifyAppliedMigrations(migrations, applied);
  const appliedVersions = new Set(applied.map((entry) => entry.version));
  const pending = migrations.filter((migration) => !appliedVersions.has(migration.version));
  if (pending.length > 0)
    throw new Error(
      `Database migrations are pending: ${pending.map(({ version }) => version).join(", ")}`,
    );
}

export async function applyDatabaseMigrations(database) {
  const migrations = await loadMigrations();
  await database.begin(async (transaction) => {
    await transaction`SELECT pg_advisory_xact_lock(${migrationLockKey})`;
    await transaction`
      CREATE TABLE IF NOT EXISTS playground_schema_migrations (
        version text PRIMARY KEY,
        checksum char(64) NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `;
    const applied = await transaction`
      SELECT version, checksum FROM playground_schema_migrations ORDER BY version
    `;
    verifyAppliedMigrations(migrations, applied);
    const appliedVersions = new Set(applied.map((entry) => entry.version));
    for (const migration of migrations) {
      if (appliedVersions.has(migration.version)) continue;
      await transaction.unsafe(migration.sql);
      await transaction`
        INSERT INTO playground_schema_migrations (version, checksum)
        VALUES (${migration.version}, ${migration.checksum})
      `;
    }
  });
}

export async function runDatabaseMigrations(databaseURL) {
  const database = postgres(databaseURL, {
    max: 1,
    connect_timeout: 5,
    prepare: false,
  });
  try {
    await applyDatabaseMigrations(database);
  } finally {
    await database.end({ timeout: 5 });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const databaseURL = process.env.DATABASE_URL;
  if (!databaseURL) throw new Error("DATABASE_URL is required");
  await runDatabaseMigrations(databaseURL);
}
