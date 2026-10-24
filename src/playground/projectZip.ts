import { BlobReader, BlobWriter, ZipReader, ZipWriter } from "@zip.js/zip.js";
import {
  isValidProjectFileSet,
  isValidProjectPath,
  normalizeImportedProjectPaths,
  projectLimits,
} from "./projectValidation.js";
import type { ProjectFile } from "./types";

const maxArchiveEntries = projectLimits.projectFiles * 2;
const maxArchiveBytes = projectLimits.projectBytes + 32 * 1024 * 1024;

type Project = {
  source: string;
  files: Record<string, ProjectFile>;
};

export async function readProjectArchive(archive: File): Promise<File[]> {
  if (archive.size > maxArchiveBytes) {
    throw new Error(`ZIPファイルの上限は${maxArchiveBytes / 1024 / 1024} MiBです。`);
  }
  const reader = new ZipReader(new BlobReader(archive));
  try {
    const allEntries = [];
    for await (const entry of reader.getEntriesGenerator()) {
      if (allEntries.length >= maxArchiveEntries) {
        throw new Error(`ZIPファイルの上限は${maxArchiveEntries.toLocaleString()}エントリーです。`);
      }
      allEntries.push(entry);
    }
    const entries = allEntries.filter((entry) => !entry.directory);
    if (entries.length === 0) throw new Error("ZIPファイルにファイルがありません。");
    if (entries.length > projectLimits.projectFiles) {
      throw new Error(
        `プロジェクトの上限は${projectLimits.projectFiles.toLocaleString()}ファイルです。`,
      );
    }

    let declaredBytes = 0;
    for (const entry of allEntries) {
      const path = entry.directory ? entry.filename.replace(/\/$/, "") : entry.filename;
      if (!isValidProjectPath(path)) throw new Error("ZIPファイルに無効なパスがあります。");
    }
    const rawFilePaths: string[] = entries.map((entry) => entry.filename as string);
    const normalizedFilePaths: string[] = normalizeImportedProjectPaths(rawFilePaths, true);
    const filePaths = new Set(normalizedFilePaths);
    if (new Set(rawFilePaths).size !== rawFilePaths.length)
      throw new Error("ZIPファイルに重複したパスがあります。");
    if (!isValidProjectFileSet(normalizedFilePaths))
      throw new Error("ZIPファイルに重複または衝突するパスがあります。");

    const roots = new Set(rawFilePaths.map((path) => path.split("/")[0]));
    const stripRoot =
      roots.size === 1 && normalizedFilePaths.some((path, index) => path !== rawFilePaths[index]);
    const commonRoot = stripRoot ? `${rawFilePaths[0].split("/")[0]}/` : undefined;
    const directories = new Set<string>();
    for (const entry of allEntries) {
      if (!entry.directory) continue;
      const path = entry.filename.replace(/\/$/, "");
      const normalizedPath =
        commonRoot && path === commonRoot.slice(0, -1)
          ? ""
          : commonRoot && path.startsWith(commonRoot)
            ? path.slice(commonRoot.length)
            : path;
      if (normalizedPath === "") continue;
      if (!isValidProjectPath(normalizedPath) || directories.has(normalizedPath))
        throw new Error("ZIPファイルに無効または重複したディレクトリがあります。");
      let separator = normalizedPath.indexOf("/");
      let overlapsFile = filePaths.has(normalizedPath);
      while (!overlapsFile && separator !== -1) {
        overlapsFile = filePaths.has(normalizedPath.slice(0, separator));
        separator = normalizedPath.indexOf("/", separator + 1);
      }
      if (overlapsFile) {
        throw new Error("ZIPファイルのファイルとディレクトリが衝突しています。");
      }
      directories.add(normalizedPath);
    }
    for (const entry of entries) {
      if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 0) {
        throw new Error("ZIPファイルのサイズ情報が無効です。");
      }
      declaredBytes += entry.uncompressedSize;
      if (declaredBytes > projectLimits.projectBytes) {
        throw new Error(
          `プロジェクトの上限は${projectLimits.projectBytes / 1024 / 1024} MiBです。`,
        );
      }
    }

    if (!normalizedFilePaths.includes("main.mcl")) {
      throw new Error("ZIPファイルのルートにmain.mclが必要です。");
    }

    const files: File[] = [];
    let actualBytes = 0;
    for (const entry of entries) {
      const output = new BlobWriter();
      const outputWriter = output.writable.getWriter();
      const boundedWriter = new WritableStream<Uint8Array>({
        write(chunk) {
          if (actualBytes + chunk.byteLength > projectLimits.projectBytes) {
            throw new Error(
              `プロジェクトの上限は${projectLimits.projectBytes / 1024 / 1024} MiBです。`,
            );
          }
          actualBytes += chunk.byteLength;
          return outputWriter.write(chunk);
        },
        close() {
          return outputWriter.close();
        },
        abort(reason) {
          return outputWriter.abort(reason);
        },
      });
      await entry.getData(boundedWriter);
      const blob = await output.getData();
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
    throw new Error(
      `プロジェクトの上限は${projectLimits.projectFiles.toLocaleString()}ファイルです。`,
    );
  }
  const encoder = new TextEncoder();
  let totalBytes = encoder.encode(project.source).byteLength;
  if (totalBytes > projectLimits.projectBytes) {
    throw new Error(`プロジェクトの上限は${projectLimits.projectBytes / 1024 / 1024} MiBです。`);
  }
  for (const [path, file] of files) {
    if (!isValidProjectPath(path) || path === "main.mcl")
      throw new Error("プロジェクトに無効なパスがあります。");
    totalBytes +=
      file.encoding === "utf8" ? encoder.encode(file.content).byteLength : file.bytes.byteLength;
    if (totalBytes > projectLimits.projectBytes) {
      throw new Error(`プロジェクトの上限は${projectLimits.projectBytes / 1024 / 1024} MiBです。`);
    }
  }
  if (!isValidProjectFileSet(["main.mcl", ...files.map(([path]) => path)]))
    throw new Error("プロジェクトに重複または衝突するパスがあります。");

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
