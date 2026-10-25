import type { TFunction } from "i18next";

export type SharedProjectFile =
  | { encoding: "utf8"; content: string }
  | { encoding: "binary"; content: string };

export type SharedProjectSnapshot = {
  version: 1;
  source: string;
  files: Record<string, SharedProjectFile>;
  activePath?: string;
};

export type CreatedShortShare = {
  id: string;
  expiresAt: string;
};

const endpoint = "/api/playground/snippets";
const maxRequestBytes = 64 * 1024 * 1024;
const shareIDPattern = /^[A-Za-z0-9_-]{22}$/;

export class ShareAPIError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ShareAPIError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isSnapshotFile(value: unknown): value is SharedProjectFile {
  if (!isRecord(value) || typeof value.content !== "string") return false;
  return value.encoding === "utf8" || value.encoding === "binary";
}

function parseSnapshot(value: unknown, t: TFunction<"starlight">): SharedProjectSnapshot {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    typeof value.source !== "string" ||
    !isRecord(value.files) ||
    Object.values(value.files).some((file) => !isSnapshotFile(file)) ||
    (value.activePath !== undefined && typeof value.activePath !== "string")
  )
    throw new Error(t("shareSnapshotInvalid"));

  return {
    version: 1,
    source: value.source,
    files: value.files as Record<string, SharedProjectFile>,
    ...(typeof value.activePath === "string" ? { activePath: value.activePath } : {}),
  };
}

async function readJSON(response: Response, t: TFunction<"starlight">): Promise<unknown> {
  const contentType = response.headers.get("content-type");
  if (!contentType?.toLowerCase().includes("application/json"))
    throw new Error(t("shareResponseNotJSON"));
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxRequestBytes)
    throw new Error(t("shareResponseTooLarge"));
  if (!response.body) throw new Error(t("shareResponseUnreadable"));

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxRequestBytes) {
      await reader.cancel();
      throw new Error(t("shareResponseTooLarge"));
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
}

export async function createShortShare(
  snapshot: Omit<SharedProjectSnapshot, "version">,
  t: TFunction<"starlight">,
  signal?: AbortSignal,
): Promise<CreatedShortShare> {
  const body = JSON.stringify({ version: 1, ...snapshot });
  if (new TextEncoder().encode(body).byteLength > maxRequestBytes)
    throw new Error(t("shareSizeLimit"));

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body,
    signal,
  });
  if (!response.ok) {
    if (response.status === 429) throw new ShareAPIError(t("shareRateLimit"), 429);
    throw new ShareAPIError(t("shareCreateFailed", { status: response.status }), response.status);
  }

  const result: unknown = await readJSON(response, t);
  if (
    !isRecord(result) ||
    typeof result.id !== "string" ||
    !shareIDPattern.test(result.id) ||
    typeof result.expiresAt !== "string" ||
    !Number.isFinite(Date.parse(result.expiresAt))
  )
    throw new Error(t("shareResponseInvalid"));

  return { id: result.id, expiresAt: result.expiresAt };
}

export async function loadShortShare(
  id: string,
  t: TFunction<"starlight">,
  signal?: AbortSignal,
): Promise<SharedProjectSnapshot> {
  if (!shareIDPattern.test(id)) throw new Error(t("shareIDInvalid"));

  const response = await fetch(`${endpoint}/${encodeURIComponent(id)}`, {
    headers: { accept: "application/json" },
    signal,
  });
  if (response.status === 404) throw new Error(t("shareNotFound"));
  if (!response.ok)
    throw new ShareAPIError(t("shareLoadFailed", { status: response.status }), response.status);
  return parseSnapshot(await readJSON(response, t), t);
}
