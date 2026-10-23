import type { ProjectFile } from "./types";

const maxSharedBytes = 32 * 1024 * 1024;
const maxSharedFiles = 4096;
const maxFragmentBytes = 2 * 1024 * 1024;
const maxSerializedBytes = Math.ceil(maxSharedBytes * 4 / 3) + 1024 * 1024;

type SharedProject = { source: string; files: Record<string, ProjectFile>; activePath?: string };

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function decodeBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(value) || value.length % 4 === 1) {
    throw new Error("Invalid shared project encoding");
  }
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function validPath(path: string): boolean {
  return path.length > 0 && !path.startsWith("/") && !path.includes("\\") &&
    !path.includes("\0") && path.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

async function transform(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const writer = stream.writable.getWriter();
  const input = new Uint8Array(new ArrayBuffer(bytes.byteLength));
  input.set(bytes);
  const write = writer.write(input);
  const close = writer.close();
  const output = new Response(stream.readable).arrayBuffer();
  await Promise.all([write, close]);
  return new Uint8Array(await output);
}

function serialize(project: SharedProject): Uint8Array {
  const data: Record<string, unknown> = {};
  if (typeof project.source !== "string" || !project.files || typeof project.files !== "object" || Array.isArray(project.files)) {
    throw new Error("Invalid project");
  }
  const entries = Object.entries(project.files);
  if (entries.length > maxSharedFiles) throw new Error("Project has too many files");
  let totalBytes = new TextEncoder().encode(project.source).byteLength;
  if (totalBytes > maxSharedBytes) throw new Error("Project is too large to share");
  const files: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const [path, file] of entries) {
    if (!validPath(path) || path === "main.mcl") throw new Error("Invalid project file path");
    if (file?.encoding === "utf8" && typeof file.content === "string") {
      totalBytes += new TextEncoder().encode(file.content).byteLength;
      files[path] = { encoding: "utf8", content: file.content };
    } else if (file?.encoding === "binary" && file.bytes instanceof Uint8Array) {
      totalBytes += file.bytes.byteLength;
      files[path] = { encoding: "binary", content: encodeBase64Url(file.bytes) };
    } else {
      throw new Error("Invalid project file");
    }
    if (totalBytes > maxSharedBytes) throw new Error("Project is too large to share");
  }
  data.source = project.source;
  data.files = files;
  if (project.activePath !== undefined) {
    if (!validPath(project.activePath) || !project.activePath.endsWith(".mcl") || project.activePath !== "main.mcl" && !Object.hasOwn(project.files, project.activePath)) {
      throw new Error("Invalid active project path");
    }
    data.activePath = project.activePath;
  }
  return new TextEncoder().encode(JSON.stringify(data));
}

export async function encodeSharedProject(project: SharedProject): Promise<string> {
  if (typeof CompressionStream === "undefined") throw new Error("Compression is unavailable");
  const compressed = await transform(serialize(project), new CompressionStream("gzip"));
  const encoded = encodeBase64Url(compressed);
  if (encoded.length > maxFragmentBytes) throw new Error("Project is too large to share in a URL");
  return `#project=${encoded}`;
}

export async function decodeSharedProject(fragment: string): Promise<SharedProject | undefined> {
  try {
    if (typeof DecompressionStream === "undefined") throw new Error("Compression is unavailable");
    const value = fragment.startsWith("#") ? fragment.slice(1) : fragment;
    if (!value.startsWith("project=")) return undefined;
    const encoded = value.slice("project=".length);
    if (encoded.length > maxFragmentBytes) throw new Error("Shared project is too large");
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
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const decoded: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!decoded || typeof decoded !== "object") throw new Error("Invalid project");
    const record = decoded as Record<string, unknown>;
    if (typeof record.source !== "string" || !record.files || typeof record.files !== "object" || Array.isArray(record.files)) {
      throw new Error("Invalid project");
    }
    if (record.activePath !== undefined && (typeof record.activePath !== "string" || !validPath(record.activePath) || !record.activePath.endsWith(".mcl"))) {
      throw new Error("Invalid active project path");
    }
    const entries = Object.entries(record.files as Record<string, unknown>);
    if (entries.length > maxSharedFiles) throw new Error("Project has too many files");
    const files: Record<string, ProjectFile> = Object.create(null) as Record<string, ProjectFile>;
    let totalBytes = new TextEncoder().encode(record.source).byteLength;
    if (totalBytes > maxSharedBytes) throw new Error("Project is too large");
    for (const [path, item] of entries) {
      if (!validPath(path) || path === "main.mcl" || !item || typeof item !== "object") throw new Error("Invalid project file path");
      const file = item as Record<string, unknown>;
      if (file.encoding === "utf8" && typeof file.content === "string") {
        totalBytes += new TextEncoder().encode(file.content).byteLength;
        files[path] = { encoding: "utf8", content: file.content };
      } else if (file.encoding === "binary" && typeof file.content === "string") {
        const binary = decodeBase64Url(file.content);
        totalBytes += binary.byteLength;
        files[path] = { encoding: "binary", bytes: binary };
      } else throw new Error("Invalid project file");
      if (totalBytes > maxSharedBytes) throw new Error("Project is too large");
    }
    if (record.activePath !== undefined && record.activePath !== "main.mcl" && !Object.hasOwn(files, record.activePath)) throw new Error("Invalid active project path");
    return { source: record.source, files, ...(typeof record.activePath === "string" ? { activePath: record.activePath } : {}) };
  } catch (error) {
    if (error instanceof Error && /too large|too many files|Compression is unavailable/.test(error.message)) throw error;
    throw new Error("Invalid shared project");
  }
}
