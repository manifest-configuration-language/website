import {
  BlobReader,
  BlobWriter,
  ZipReader,
  ZipWriter,
} from "@zip.js/zip.js";
import { projectLimits } from "./projectValidation.js";
import { isValidProjectPath } from "./projectFiles.js";
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
      throw new Error(`プロジェクトの上限は${projectLimits.projectFiles.toLocaleString()}ファイルです。`);
    }

    const paths = new Set<string>();
    let declaredBytes = 0;
    for (const entry of allEntries) {
      const path = entry.directory ? entry.filename.replace(/\/$/, "") : entry.filename;
      if (!isValidProjectPath(path)) throw new Error("ZIPファイルに無効なパスがあります。");
    }
    for (const entry of entries) {
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
      const output = new BlobWriter();
      const outputWriter = output.writable.getWriter();
      const boundedWriter = new WritableStream<Uint8Array>({
        write(chunk) {
          if (actualBytes + chunk.byteLength > projectLimits.projectBytes) {
            throw new Error(`プロジェクトの上限は${projectLimits.projectBytes / 1024 / 1024} MiBです。`);
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
    throw new Error(`プロジェクトの上限は${projectLimits.projectFiles.toLocaleString()}ファイルです。`);
  }
  const encoder = new TextEncoder();
  let totalBytes = encoder.encode(project.source).byteLength;
  if (totalBytes > projectLimits.projectBytes) {
    throw new Error(`プロジェクトの上限は${projectLimits.projectBytes / 1024 / 1024} MiBです。`);
  }
  for (const [path, file] of files) {
    if (!isValidProjectPath(path) || path === "main.mcl") throw new Error("プロジェクトに無効なパスがあります。");
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
