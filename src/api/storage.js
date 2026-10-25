import { createHash } from "node:crypto";
import { gunzip, gzip } from "node:zlib";
import { promisify } from "node:util";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { Cluster } from "ioredis";
import postgres from "postgres";
import { maximumRequestBytes } from "./snapshot.js";
import { verifyDatabaseMigrations } from "./migrate.js";

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);
const maxStoredBytes = Number(process.env.SHARE_STORAGE_MAX_BYTES ?? 10 * 1024 ** 3);
const storageLockKey = 741_203_808;
const requestLimitScript =
  "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return n<=tonumber(ARGV[2]) and 1 or 0";
const uploadBytesScript =
  "local n=tonumber(redis.call('GET',KEYS[1]) or '0'); local a=tonumber(ARGV[1]); if n+a>tonumber(ARGV[2]) then return 0 end; local t=redis.call('INCRBY',KEYS[1],a); if n==0 then redis.call('EXPIRE',KEYS[1],ARGV[3]) end; return t";

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function configuredTTLSeconds() {
  const days = Number(process.env.SHARE_TTL_DAYS ?? 90);
  if (!Number.isSafeInteger(days) || days < 1 || days > 365)
    throw new Error("SHARE_TTL_DAYS must be an integer between 1 and 365");
  return days * 86_400;
}

export async function createShareStorage() {
  const database = postgres(required("DATABASE_URL"), {
    max: 8,
    connect_timeout: 5,
    idle_timeout: 30,
    prepare: false,
  });
  const valkeyURL = new URL(required("VALKEY_URL"));
  if (valkeyURL.protocol !== "redis:" || !valkeyURL.hostname)
    throw new Error("VALKEY_URL must point to a Redis Cluster endpoint");
  const redis = new Cluster([{ host: valkeyURL.hostname, port: Number(valkeyURL.port || 6379) }], {
    lazyConnect: true,
    enableOfflineQueue: false,
    redisOptions: { maxRetriesPerRequest: 1 },
  });
  redis.on("error", () => {
    process.stderr.write("Valkey connection failed.\n");
  });
  const s3 = new S3Client({
    endpoint: required("S3_ENDPOINT"),
    region: process.env.S3_REGION ?? "us-east-1",
    forcePathStyle: true,
    credentials: {
      accessKeyId: required("S3_ACCESS_KEY_ID"),
      secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
    },
  });
  const bucket = required("S3_BUCKET");
  const ttlSeconds = configuredTTLSeconds();
  const runtimeVersion = process.env.MCL_RUNTIME_VERSION ?? "unknown";
  const dailyUploadLimit = Number(process.env.SHARE_DAILY_UPLOAD_BYTES ?? 128 * 1024 * 1024);
  if (!Number.isSafeInteger(maxStoredBytes) || maxStoredBytes <= 0)
    throw new Error("SHARE_STORAGE_MAX_BYTES must be a positive integer");
  if (!Number.isSafeInteger(dailyUploadLimit) || dailyUploadLimit <= 0)
    throw new Error("SHARE_DAILY_UPLOAD_BYTES must be a positive integer");

  await verifyDatabaseMigrations(database);
  await redis.connect();
  await s3.send(new HeadBucketCommand({ Bucket: bucket }));

  async function allowRequest(key, limit, windowSeconds) {
    return Number(await redis.eval(requestLimitScript, 1, key, windowSeconds, limit)) === 1;
  }

  async function allowUploadBytes(key, bytes) {
    const total = Number(
      await redis.eval(uploadBytesScript, 1, key, bytes, dailyUploadLimit, 86_400),
    );
    return Number.isSafeInteger(total) && total >= bytes;
  }

  async function createShare({ id, serialized, contentBytes }) {
    const compressed = await gzipAsync(serialized, { level: 6 });
    const digest = createHash("sha256").update(serialized).digest("hex");
    const objectKey = `playground-snippets/${id}.json.gz`;
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    await database.begin(async (transaction) => {
      await transaction`SELECT pg_advisory_xact_lock(${storageLockKey})`;
      const rows =
        await transaction`SELECT COALESCE(SUM(stored_bytes), 0)::bigint AS used_bytes FROM playground_snippets`;
      const usedBytes = Number(rows[0].used_bytes);
      if (!Number.isSafeInteger(usedBytes) || usedBytes + compressed.byteLength > maxStoredBytes)
        throw Object.assign(new Error("Share storage quota exceeded"), { status: 507 });
      await transaction`
        INSERT INTO playground_snippets
          (id, object_key, expires_at, content_bytes, stored_bytes, content_sha256, runtime_version, status)
        VALUES
          (${id}, ${objectKey}, ${expiresAt}, ${contentBytes}, ${compressed.byteLength}, ${digest}, ${runtimeVersion}, 'pending')
      `;
    });
    try {
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: objectKey,
          Body: compressed,
          ContentType: "application/json",
          ContentEncoding: "gzip",
          CacheControl: "private, no-store",
          Metadata: { sha256: digest },
        }),
      );
      await database`UPDATE playground_snippets SET status = 'ready' WHERE id = ${id}`;
    } catch (error) {
      await s3
        .send(new DeleteObjectCommand({ Bucket: bucket, Key: objectKey }))
        .catch(() => undefined);
      await database`DELETE FROM playground_snippets WHERE id = ${id}`;
      throw error;
    }
    return { id, expiresAt: expiresAt.toISOString() };
  }

  async function getShare(id) {
    const rows = await database`
      SELECT object_key, content_bytes, stored_bytes, content_sha256, runtime_version
      FROM playground_snippets WHERE id = ${id} AND status = 'ready' AND expires_at > now() LIMIT 1
    `;
    const record = rows[0];
    if (!record) return undefined;
    const storedBytes = Number(record.stored_bytes);
    if (!Number.isSafeInteger(storedBytes) || storedBytes < 0 || storedBytes > maximumRequestBytes)
      throw new Error("Share object is corrupt");
    const object = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: record.object_key }));
    if (!object.Body) throw new Error("Share object is missing");
    const compressed = Buffer.from(await object.Body.transformToByteArray());
    if (compressed.byteLength !== storedBytes) throw new Error("Share object is corrupt");
    const serialized = await gunzipAsync(compressed, { maxOutputLength: maximumRequestBytes });
    if (serialized.byteLength !== Number(record.content_bytes))
      throw new Error("Share object is corrupt");
    const digest = createHash("sha256").update(serialized).digest("hex");
    if (digest !== record.content_sha256) throw new Error("Share object is corrupt");
    return {
      snapshot: JSON.parse(serialized.toString("utf8")),
      runtimeVersion: record.runtime_version,
    };
  }

  async function deleteExpiredShares(batchSize = 100) {
    const rows = await database`
      SELECT id, object_key FROM playground_snippets
      WHERE (status = 'ready' AND expires_at <= now())
        OR (status = 'pending' AND created_at <= now() - interval '15 minutes')
      ORDER BY created_at LIMIT ${batchSize}
    `;
    for (const row of rows) {
      try {
        await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: row.object_key }));
        await database`DELETE FROM playground_snippets WHERE id = ${row.id}`;
      } catch {
        process.stderr.write("Unable to remove an expired Playground share.\n");
      }
    }
    return rows.length;
  }

  return {
    allowRequest,
    allowUploadBytes,
    createShare,
    getShare,
    deleteExpiredShares,
    async close() {
      s3.destroy();
      await Promise.all([database.end({ timeout: 5 }), redis.quit()]);
    },
  };
}
