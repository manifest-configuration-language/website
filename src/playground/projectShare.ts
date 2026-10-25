import {
  isValidProjectFileSet,
  isValidProjectPath,
  projectLimits,
  projectSnapshotError,
} from "./projectValidation.js";
import type { ProjectFile } from "./types";

const maxSharedBytes = projectLimits.projectBytes;
const maxSharedFiles = projectLimits.projectFiles - 1;
const maxFragmentLength = 2 * 1024 * 1024;
const projectFragmentPrefix = "project=";
const maxSerializedBytes = Math.ceil((maxSharedBytes * 4) / 3) + 1024 * 1024;

type SharedProject = { source: string; files: Record<string, ProjectFile>; activePath?: string };
export type SharedProjectPayload = {
  version: 1;
  source: string;
  files: Record<string, { encoding: "utf8" | "binary"; content: string }>;
  activePath?: string;
};

function encodeBase64Url(bytes: Uint8Array): string {
  return bytes.toBase64({ alphabet: "base64url", omitPadding: true });
}

function decodeBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(value) || value.length % 4 === 1) {
    throw new Error("Invalid shared project encoding");
  }
  return Uint8Array.fromBase64(value, { alphabet: "base64url", lastChunkHandling: "loose" });
}

async function transform(
  bytes: Uint8Array,
  stream: CompressionStream | DecompressionStream,
): Promise<Uint8Array> {
  const writer = stream.writable.getWriter();
  const input = new Uint8Array(new ArrayBuffer(bytes.byteLength));
  input.set(bytes);
  const write = writer.write(input);
  const close = writer.close();
  const output = new Response(stream.readable).arrayBuffer();
  await Promise.all([write, close]);
  return new Uint8Array(await output);
}

export function createSharedProjectPayload(project: SharedProject): SharedProjectPayload {
  const snapshotError = projectSnapshotError(project);
  if (snapshotError) throw new Error(snapshotError);
  const entries = Object.entries(project.files);
  const files: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const [path, file] of entries) {
    if (file?.encoding === "utf8" && typeof file.content === "string") {
      files[path] = { encoding: "utf8", content: file.content };
    } else if (file?.encoding === "binary" && file.bytes instanceof Uint8Array) {
      files[path] = { encoding: "binary", content: encodeBase64Url(file.bytes) };
    } else throw new Error("Invalid project file");
  }
  return {
    version: 1,
    source: project.source,
    files: files as SharedProjectPayload["files"],
    ...(project.activePath === undefined ? {} : { activePath: project.activePath }),
  };
}

function serialize(project: SharedProject): Uint8Array {
  const { version: _version, ...data } = createSharedProjectPayload(project);
  return new TextEncoder().encode(JSON.stringify(data));
}

export async function encodeSharedProject(project: SharedProject): Promise<string> {
  if (typeof CompressionStream === "undefined") throw new Error("Compression is unavailable");
  const serialized = serialize(project);
  if (serialized.byteLength > maxSerializedBytes)
    throw new Error("Project serialization exceeds the share size limit");
  const compressed = await transform(serialized, new CompressionStream("gzip"));
  const encoded = encodeBase64Url(compressed);
  const value = `${projectFragmentPrefix}${encoded}`;
  const fragment = `#${value}`;
  if (fragment.length > maxFragmentLength) throw new Error("Project URL fragment exceeds 2 MiB");
  return fragment;
}

export function parseSharedProjectPayload(decoded: unknown): SharedProject {
  if (!decoded || typeof decoded !== "object") throw new Error("Invalid project");
  const record = decoded as Record<string, unknown>;
  if (
    (record.version !== undefined && record.version !== 1) ||
    typeof record.source !== "string" ||
    !record.files ||
    typeof record.files !== "object" ||
    Array.isArray(record.files)
  ) {
    throw new Error("Invalid project");
  }
  if (
    record.activePath !== undefined &&
    (typeof record.activePath !== "string" || !isValidProjectPath(record.activePath))
  ) {
    throw new Error("Invalid active project path");
  }
  const entries = Object.entries(record.files as Record<string, unknown>);
  if (entries.length > maxSharedFiles) throw new Error("Project has too many files");
  if (
    entries.some(([path]) => !isValidProjectPath(path) || path === "main.mcl") ||
    !isValidProjectFileSet(["main.mcl", ...entries.map(([path]) => path)])
  )
    throw new Error("Invalid project file paths");
  const files: Record<string, ProjectFile> = Object.create(null) as Record<string, ProjectFile>;
  let totalBytes = new TextEncoder().encode(record.source).byteLength;
  if (totalBytes > maxSharedBytes) throw new Error("Project is too large");
  for (const [path, item] of entries) {
    if (!isValidProjectPath(path) || path === "main.mcl" || !item || typeof item !== "object")
      throw new Error("Invalid project file path");
    const file = item as Record<string, unknown>;
    if (file.encoding === "utf8" && typeof file.content === "string") {
      totalBytes += new TextEncoder().encode(file.content).byteLength;
      files[path] = { encoding: "utf8", content: file.content };
    } else if (file.encoding === "binary" && typeof file.content === "string") {
      if (file.content.length > Math.ceil((projectLimits.projectFileBytes * 4) / 3) + 4)
        throw new Error("Project file is too large");
      const binary = decodeBase64Url(file.content);
      if (binary.byteLength > projectLimits.projectFileBytes)
        throw new Error("Project file is too large");
      totalBytes += binary.byteLength;
      files[path] = { encoding: "binary", bytes: binary };
    } else throw new Error("Invalid project file");
    if (totalBytes > maxSharedBytes) throw new Error("Project is too large");
  }
  if (
    record.activePath !== undefined &&
    record.activePath !== "main.mcl" &&
    files[record.activePath]?.encoding !== "utf8"
  )
    throw new Error("Invalid active project path");
  const project = {
    source: record.source,
    files,
    ...(typeof record.activePath === "string" ? { activePath: record.activePath } : {}),
  };
  const snapshotError = projectSnapshotError(project);
  if (snapshotError) throw new Error(snapshotError);
  return project;
}

export async function decodeSharedProject(fragment: string): Promise<SharedProject | undefined> {
  try {
    if (typeof DecompressionStream === "undefined") throw new Error("Compression is unavailable");
    const value = fragment.startsWith("#") ? fragment.slice(1) : fragment;
    if (!value.startsWith(projectFragmentPrefix)) return undefined;
    const fragmentLength = fragment.length + (fragment.startsWith("#") ? 0 : 1);
    if (fragmentLength > maxFragmentLength) throw new Error("Project URL fragment exceeds 2 MiB");
    const encoded = value.slice(projectFragmentPrefix.length);
    const compressed = decodeBase64Url(encoded);
    const stream = new DecompressionStream("gzip");
    const writer = stream.writable.getWriter();
    const input = new Uint8Array(new ArrayBuffer(compressed.byteLength));
    input.set(compressed);
    const write = writer.write(input);
    const close = writer.close();
    const reader = stream.readable.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      size += chunk.byteLength;
      if (size > maxSerializedBytes) {
        await reader.cancel();
        throw new Error("Shared project is too large");
      }
      chunks.push(chunk);
    }
    await Promise.all([write, close]);
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const decoded: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    return parseSharedProjectPayload(decoded);
  } catch (error) {
    if (
      error instanceof Error &&
      /too large|too many files|Compression is unavailable|URL fragment exceeds/.test(error.message)
    )
      throw error;
    throw new Error("Invalid shared project");
  }
}
