import { createHash, randomBytes } from "node:crypto";
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
import { maximumRequestBytes, validateSnapshot } from "./snapshot.js";
import { verifyDatabaseMigrations } from "./migrate.js";

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);
const maxStoredBytes = Number(process.env.SHARE_STORAGE_MAX_BYTES ?? 10 * 1024 ** 3);
const storageLockKey = 741_203_808;
const requestLimitScript = `
  redis.replicate_commands()
  local time = redis.call('TIME')
  local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
  local window = tonumber(ARGV[1])
  local limit = tonumber(ARGV[2])
  redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - window)
  if redis.call('ZCARD', KEYS[1]) >= limit then return 0 end
  redis.call('ZADD', KEYS[1], now, ARGV[3])
  redis.call('PEXPIRE', KEYS[1], window)
  return 1
`;
const uploadBytesScript = `
  redis.replicate_commands()
  local time = redis.call('TIME')
  local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
  local window = tonumber(ARGV[1])
  local bytes = tonumber(ARGV[2])
  local limit = tonumber(ARGV[3])
  redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - window)
  local entries = redis.call('ZRANGE', KEYS[1], 0, -1)
  local used = 0
  for _, entry in ipairs(entries) do
    local amount = string.match(entry, ':(%d+)$')
    if amount then used = used + tonumber(amount) end
  end
  if used + bytes > limit then return 0 end
  redis.call('ZADD', KEYS[1], now, ARGV[4] .. ':' .. bytes)
  redis.call('PEXPIRE', KEYS[1], window)
  return 1
`;
const corruptShare = () => new Error("Share object is corrupt");

export async function decodeShareObject({ compressed, storedBytes, contentBytes, contentSha256 }) {
  const expectedStoredBytes = Number(storedBytes);
  const expectedContentBytes = Number(contentBytes);
  if (
    !Number.isSafeInteger(expectedStoredBytes) ||
    expectedStoredBytes < 0 ||
    expectedStoredBytes > maximumRequestBytes ||
    compressed.byteLength !== expectedStoredBytes ||
    !Number.isSafeInteger(expectedContentBytes) ||
    expectedContentBytes < 0
  )
    throw corruptShare();

  let serialized;
  try {
    serialized = await gunzipAsync(compressed, { maxOutputLength: maximumRequestBytes });
  } catch {
    throw corruptShare();
  }
  const digest = createHash("sha256").update(serialized).digest("hex");
  if (digest !== contentSha256) throw corruptShare();

  let value;
  try {
    value = JSON.parse(serialized.toString("utf8"));
  } catch {
    throw corruptShare();
  }
  let validated;
  try {
    validated = validateSnapshot(value);
  } catch {
    throw corruptShare();
  }
  if (validated.contentBytes !== expectedContentBytes) throw corruptShare();
  return validated.snapshot;
}

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
    if (
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      !Number.isSafeInteger(windowSeconds) ||
      windowSeconds < 1
    )
      throw new Error("Request limit and window must be positive integers");
    const windowMilliseconds = windowSeconds * 1000;
    if (!Number.isSafeInteger(windowMilliseconds))
      throw new Error("Request limit window is too large");
    return (
      Number(
        await redis.eval(
          requestLimitScript,
          1,
          key,
          windowMilliseconds,
          limit,
          randomBytes(16).toString("hex"),
        ),
      ) === 1
    );
  }

  async function allowUploadBytes(key, bytes) {
    if (!Number.isSafeInteger(bytes) || bytes < 0)
      throw new Error("Upload byte count must be a non-negative integer");
    return (
      Number(
        await redis.eval(
          uploadBytesScript,
          1,
          key,
          86_400_000,
          bytes,
          dailyUploadLimit,
          randomBytes(16).toString("hex"),
        ),
      ) === 1
    );
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
      let pending = false;
      try {
        await database`UPDATE playground_snippets SET status = 'pending' WHERE id = ${id}`;
        pending = true;
      } catch {
        // Keep the object and row when the database cannot record the cleanup state.
      }
      if (pending) {
        try {
          await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: objectKey }));
          await database`DELETE FROM playground_snippets WHERE id = ${id}`;
        } catch {
          // The periodic collector retries deletion while the pending row remains.
        }
      }
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
    const object = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: record.object_key }));
    if (!object.Body) throw new Error("Share object is missing");
    const compressed = Buffer.from(await object.Body.transformToByteArray());
    return {
      snapshot: await decodeShareObject({
        compressed,
        storedBytes: record.stored_bytes,
        contentBytes: record.content_bytes,
        contentSha256: record.content_sha256,
      }),
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
