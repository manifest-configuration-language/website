import {
  BlobReader,
  BlobWriter,
  ZipReader,
  ZipWriter,
} from "@zip.js/zip.js";
import { projectLimits } from "./projectValidation.js";
import type { ProjectFile } from "./types";

type Project = {
  source: string;
  files: Record<string, ProjectFile>;
};

function validPath(path: string): boolean {
  return path.length > 0 && !path.startsWith("/") && !path.includes("\\") &&
    !path.includes("\0") && path.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

export async function readProjectArchive(archive: File): Promise<File[]> {
  const reader = new ZipReader(new BlobReader(archive));
  try {
    const entries = (await reader.getEntries()).filter((entry) => !entry.directory);
    if (entries.length === 0) throw new Error("ZIPファイルにファイルがありません。");
    if (entries.length > projectLimits.projectFiles) {
      throw new Error(`プロジェクトの上限は${projectLimits.projectFiles.toLocaleString()}ファイルです。`);
    }

    const paths = new Set<string>();
    let declaredBytes = 0;
    for (const entry of entries) {
      if (!validPath(entry.filename)) throw new Error("ZIPファイルに無効なパスがあります。");
      if (paths.has(entry.filename)) throw new Error(`ZIPファイルに重複したパスがあります: ${entry.filename}`);
      paths.add(entry.filename);
      if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 0) {
        throw new Error("ZIPファイルのサイズ情報が無効です。");
      }
      declaredBytes += entry.uncompressedSize;
      if (declaredBytes > projectLimits.projectBytes) {
        throw new Error(`プロジェクトの上限は${projectLimits.projectBytes / 1024 / 1024} MiBです。`);
      }
    }

    if (![...paths].some((path) => path === "main.mcl" || path.endsWith("/main.mcl"))) {
      throw new Error("ZIPファイルのルートにmain.mclが必要です。");
    }

    const files: File[] = [];
    let actualBytes = 0;
    for (const entry of entries) {
      const blob = await entry.getData(new BlobWriter());
      actualBytes += blob.size;
      if (actualBytes > projectLimits.projectBytes) {
        throw new Error(`プロジェクトの上限は${projectLimits.projectBytes / 1024 / 1024} MiBです。`);
      }
      const file = new File([blob], entry.filename.split("/").at(-1) ?? entry.filename);
      Object.defineProperty(file, "webkitRelativePath", { value: entry.filename });
      files.push(file);
    }
    return files;
  } finally {
    await reader.close();
  }
}

export async function writeProjectArchive(project: Project): Promise<Blob> {
  const files = Object.entries(project.files).sort(([left], [right]) => left.localeCompare(right));
  if (files.length + 1 > projectLimits.projectFiles) {
    throw new Error(`プロジェクトの上限は${projectLimits.projectFiles.toLocaleString()}ファイルです。`);
  }
  const encoder = new TextEncoder();
  let totalBytes = encoder.encode(project.source).byteLength;
  if (totalBytes > projectLimits.projectBytes) {
    throw new Error(`プロジェクトの上限は${projectLimits.projectBytes / 1024 / 1024} MiBです。`);
  }
  for (const [path, file] of files) {
    if (!validPath(path) || path === "main.mcl") throw new Error("プロジェクトに無効なパスがあります。");
    totalBytes += file.encoding === "utf8" ? encoder.encode(file.content).byteLength : file.bytes.byteLength;
    if (totalBytes > projectLimits.projectBytes) {
      throw new Error(`プロジェクトの上限は${projectLimits.projectBytes / 1024 / 1024} MiBです。`);
    }
  }

  const output = new BlobWriter("application/zip");
  const writer = new ZipWriter(output, { level: 6 });
  const entries: Array<[string, Blob]> = [
    ["main.mcl", new Blob([project.source], { type: "text/plain;charset=utf-8" })],
  ];
  for (const [path, file] of files) {
    entries.push([
      path,
      file.encoding === "utf8"
        ? new Blob([file.content], { type: "text/plain;charset=utf-8" })
        : new Blob([Uint8Array.from(file.bytes).buffer]),
    ]);
  }

  try {
    for (const [path, blob] of entries) await writer.add(path, new BlobReader(blob));
    await writer.close();
    return await output.getData();
  } catch (cause) {
    await writer.close().catch(() => undefined);
    throw cause;
  }
}
