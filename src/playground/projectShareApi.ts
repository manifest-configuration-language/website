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
const shareIDPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isSnapshotFile(value: unknown): value is SharedProjectFile {
  if (!isRecord(value) || typeof value.content !== "string") return false;
  return value.encoding === "utf8" || value.encoding === "binary";
}

function parseSnapshot(value: unknown): SharedProjectSnapshot {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    typeof value.source !== "string" ||
    !isRecord(value.files) ||
    Object.values(value.files).some((file) => !isSnapshotFile(file)) ||
    (value.activePath !== undefined && typeof value.activePath !== "string")
  )
    throw new Error("共有プロジェクトの形式が正しくありません。");

  return {
    version: 1,
    source: value.source,
    files: value.files as Record<string, SharedProjectFile>,
    ...(typeof value.activePath === "string" ? { activePath: value.activePath } : {}),
  };
}

async function readJSON(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type");
  if (!contentType?.toLowerCase().includes("application/json"))
    throw new Error("共有APIからJSON以外の応答が返りました。");
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxRequestBytes)
    throw new Error("共有APIの応答サイズが上限を超えています。");
  if (!response.body) throw new Error("共有APIの応答を読み込めませんでした。");

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxRequestBytes) {
      await reader.cancel();
      throw new Error("共有APIの応答サイズが上限を超えています。");
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
  signal?: AbortSignal,
): Promise<CreatedShortShare> {
  const body = JSON.stringify({ version: 1, ...snapshot });
  if (new TextEncoder().encode(body).byteLength > maxRequestBytes)
    throw new Error("共有プロジェクトのサイズが上限を超えています。");

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body,
    signal,
  });
  if (!response.ok) {
    if (response.status === 429)
      throw new Error("共有リンクの作成回数が上限に達しました。時間をおいて再試行してください。");
    throw new Error(`共有リンクを作成できませんでした（HTTP ${response.status}）。`);
  }

  const result: unknown = await readJSON(response);
  if (
    !isRecord(result) ||
    typeof result.id !== "string" ||
    !shareIDPattern.test(result.id) ||
    typeof result.expiresAt !== "string" ||
    !Number.isFinite(Date.parse(result.expiresAt))
  )
    throw new Error("共有APIの応答形式が正しくありません。");

  return { id: result.id, expiresAt: result.expiresAt };
}

export async function loadShortShare(
  id: string,
  signal?: AbortSignal,
): Promise<SharedProjectSnapshot> {
  if (!shareIDPattern.test(id)) throw new Error("共有リンクのIDが正しくありません。");

  const response = await fetch(`${endpoint}/${encodeURIComponent(id)}`, {
    headers: { accept: "application/json" },
    signal,
  });
  if (response.status === 404) throw new Error("共有リンクが見つからないか、期限が切れています。");
  if (!response.ok)
    throw new Error(`共有プロジェクトを読み込めませんでした（HTTP ${response.status}）。`);
  return parseSnapshot(await readJSON(response));
}
