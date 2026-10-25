import {
  isValidProjectFileSet,
  isValidProjectPath,
  projectLimits,
  projectSnapshotError,
} from "./projectValidation.js";
import type { ProjectFile } from "./types";

const maxSharedBytes = projectLimits.projectBytes;
const maxSharedFiles = projectLimits.projectFiles - 1;

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
