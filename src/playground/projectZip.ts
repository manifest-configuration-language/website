import { BlobReader, BlobWriter, ZipReader, ZipWriter } from "@zip.js/zip.js";
import type { TFunction } from "i18next";
import {
  isValidProjectFileSet,
  isValidProjectPath,
  normalizeImportedProjectPaths,
  projectSnapshotError,
  projectLimits,
} from "./projectValidation.js";
import type { ProjectFile } from "./types";

const maxArchiveEntries = projectLimits.projectFiles * 2;
const maxArchiveBytes = projectLimits.projectBytes + 32 * 1024 * 1024;

type Project = {
  source: string;
  files: Record<string, ProjectFile>;
};

export async function readProjectArchive(
  archive: File,
  t: TFunction<"starlight">,
): Promise<File[]> {
  if (archive.size > maxArchiveBytes) {
    throw new Error(t("archiveSizeLimit", { size: maxArchiveBytes / 1024 / 1024 }));
  }
  const reader = new ZipReader(new BlobReader(archive));
  try {
    const allEntries = [];
    for await (const entry of reader.getEntriesGenerator()) {
      if (allEntries.length >= maxArchiveEntries) {
        throw new Error(t("archiveEntryLimit", { count: maxArchiveEntries.toLocaleString() }));
      }
      allEntries.push(entry);
    }
    const entries = allEntries.filter((entry) => !entry.directory);
    if (entries.length === 0) throw new Error(t("archiveEmpty"));
    if (entries.length > projectLimits.projectFiles) {
      throw new Error(
        t("archiveFileLimit", { count: projectLimits.projectFiles.toLocaleString() }),
      );
    }

    let declaredBytes = 0;
    for (const entry of allEntries) {
      const path = entry.directory ? entry.filename.replace(/\/$/, "") : entry.filename;
      if (!isValidProjectPath(path)) throw new Error(t("archiveInvalidPath"));
    }
    const rawFilePaths: string[] = entries.map((entry) => entry.filename as string);
    const normalizedFilePaths: string[] = normalizeImportedProjectPaths(rawFilePaths, true);
    const filePaths = new Set(normalizedFilePaths);
    if (new Set(rawFilePaths).size !== rawFilePaths.length)
      throw new Error(t("archiveDuplicatePath"));
    if (!isValidProjectFileSet(normalizedFilePaths)) throw new Error(t("archivePathCollision"));

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
        throw new Error(t("archiveInvalidDirectory"));
      let separator = normalizedPath.indexOf("/");
      let overlapsFile = filePaths.has(normalizedPath);
      while (!overlapsFile && separator !== -1) {
        overlapsFile = filePaths.has(normalizedPath.slice(0, separator));
        separator = normalizedPath.indexOf("/", separator + 1);
      }
      if (overlapsFile) {
        throw new Error(t("archiveFileDirectoryCollision"));
      }
      directories.add(normalizedPath);
    }
    for (const entry of entries) {
      if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 0) {
        throw new Error(t("archiveInvalidSize"));
      }
      declaredBytes += entry.uncompressedSize;
      if (declaredBytes > projectLimits.projectBytes) {
        throw new Error(t("projectSizeLimit", { size: projectLimits.projectBytes / 1024 / 1024 }));
      }
    }

    if (!normalizedFilePaths.includes("main.mcl")) {
      throw new Error(t("archiveMainRequired"));
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
              t("projectSizeLimit", { size: projectLimits.projectBytes / 1024 / 1024 }),
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

export async function writeProjectArchive(
  project: Project,
  t: TFunction<"starlight">,
): Promise<Blob> {
  const snapshotError = projectSnapshotError(project);
  if (snapshotError) {
    if (snapshotError === "Project has too many files")
      throw new Error(
        t("archiveFileLimit", { count: projectLimits.projectFiles.toLocaleString() }),
      );
    if (snapshotError.includes("size limit"))
      throw new Error(t("projectSizeLimit", { size: projectLimits.projectBytes / 1024 / 1024 }));
    throw new Error(t("projectStructureInvalid"));
  }
  const files = Object.entries(project.files).sort(([left], [right]) => left.localeCompare(right));

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
