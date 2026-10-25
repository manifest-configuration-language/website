import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  isValidProjectFileSet,
  isValidProjectPath,
  projectLimits,
  projectSnapshotError,
} from "./projectValidation.js";
import type { PlaygroundRenameEdit, ProjectFile } from "./types";

export type PlaygroundProject = {
  source: string;
  files: Record<string, ProjectFile>;
  activePath: string;
  revision: number;
  fileSizes: Record<string, number>;
  totalBytes: number;
};

export type ProjectMutation =
  | { ok: true; project: PlaygroundProject }
  | { ok: false; error: string };

const encoder = new TextEncoder();

function projectErrorMessage(error: string, t: ReturnType<typeof useTranslation>["t"]): string {
  switch (error) {
    case "Source exceeds the size limit":
      return t("sourceSizeLimit", { size: projectLimits.sourceBytes / 1024 });
    case "Project file exceeds the size limit":
      return t("projectFileSizeLimit", {
        size: projectLimits.projectFileBytes / (1024 * 1024),
      });
    case "Project exceeds the size limit":
      return t("projectSizeLimit", { size: projectLimits.projectBytes / (1024 * 1024) });
    case "Project has too many files":
      return t("projectTooManyFiles", { count: projectLimits.projectFiles });
    case "Invalid active project path":
      return t("projectActivePathInvalid");
    case "Invalid project size metadata":
      return t("projectSizeMetadataInvalid");
    case "Project contains an invalid file path":
      return t("projectPathsInvalid");
    case "Project file paths overlap files and directories":
      return t("projectPathsOverlap");
    default:
      return t("projectUpdateFailed");
  }
}

export type RenameFileImports = (
  source: string,
  files: Record<string, ProjectFile>,
  oldPath: string,
  newPath: string,
) => Promise<PlaygroundRenameEdit[]>;

function sourceOffsetAt(source: string, position: { line: number; character: number }) {
  let offset = 0;
  for (let line = 0; line < position.line; line += 1) {
    const newline = source.indexOf("\n", offset);
    if (newline < 0) return undefined;
    offset = newline + 1;
  }
  const lineEnd = source.indexOf("\n", offset);
  const contentEnd = lineEnd < 0 ? source.length : lineEnd;
  if (position.character < 0 || offset + position.character > contentEnd) return undefined;
  return offset + position.character;
}

function applyImportEdits(
  source: string,
  edits: PlaygroundRenameEdit[],
  path: string,
): string | undefined {
  const replacements = edits
    .filter((edit) => edit.path === path)
    .map((edit) => {
      const from = sourceOffsetAt(source, edit.range.start);
      const to = sourceOffsetAt(source, edit.range.end);
      if (from === undefined || to === undefined || from > to) return undefined;
      return { from, to, text: edit.newText };
    });
  if (replacements.some((replacement) => replacement === undefined)) return undefined;
  return (replacements as Array<{ from: number; to: number; text: string }>)
    .sort((left, right) => right.from - left.from)
    .reduce(
      (content, replacement) =>
        `${content.slice(0, replacement.from)}${replacement.text}${content.slice(replacement.to)}`,
      source,
    );
}

function fileSize(file: ProjectFile): number {
  if (file?.encoding === "utf8" && typeof file.content === "string")
    return encoder.encode(file.content).byteLength;
  if (file?.encoding === "binary" && file.bytes instanceof Uint8Array) return file.bytes.byteLength;
  return -1;
}

function projectFileSizes(source: string, files: Record<string, ProjectFile>) {
  const sizes: Record<string, number> = Object.create(null);
  sizes["main.mcl"] = encoder.encode(source).byteLength;
  let totalBytes = sizes["main.mcl"];
  for (const [path, file] of Object.entries(files)) {
    const size = fileSize(file);
    sizes[path] = size;
    totalBytes += size;
  }
  return { fileSizes: sizes, totalBytes };
}

function copyProjectFiles(files: Record<string, ProjectFile>) {
  const copied = Object.create(null) as Record<string, ProjectFile>;
  for (const [path, file] of Object.entries(files)) {
    if (file?.encoding === "binary" && file.bytes instanceof Uint8Array)
      copied[path] = { encoding: "binary", bytes: file.bytes.slice() };
    else if (file?.encoding === "utf8" && typeof file.content === "string")
      copied[path] = { encoding: "utf8", content: file.content };
    else copied[path] = file;
  }
  return copied;
}

function freezeProjectFiles(files: Record<string, ProjectFile>) {
  if (
    Object.isFrozen(files) &&
    Object.values(files).every((file) => file && typeof file === "object" && Object.isFrozen(file))
  )
    return files;

  const snapshot = Object.create(null) as Record<string, ProjectFile>;
  for (const [path, file] of Object.entries(files))
    snapshot[path] =
      file && typeof file === "object" && !Object.isFrozen(file)
        ? Object.freeze({ ...file })
        : file;
  return Object.freeze(snapshot);
}

export function usePlaygroundProject(initialSource: string, renameFileImports: RenameFileImports) {
  const { t } = useTranslation();
  const [project, setProject] = useState<PlaygroundProject>(() => {
    const files = Object.freeze(Object.create(null)) as Record<string, ProjectFile>;
    const sizes = projectFileSizes(initialSource, files);
    return Object.freeze({
      source: initialSource,
      files,
      activePath: "main.mcl",
      revision: 0,
      fileSizes: Object.freeze(sizes.fileSizes),
      totalBytes: sizes.totalBytes,
    });
  });
  const projectRef = useRef(project);

  const commit = useCallback(
    (
      change: Partial<Pick<PlaygroundProject, "source" | "files" | "activePath">>,
    ): ProjectMutation => {
      const current = projectRef.current;
      if (
        change.source === undefined &&
        change.files === undefined &&
        change.activePath !== undefined
      ) {
        if (
          !isValidProjectPath(change.activePath) ||
          (change.activePath !== "main.mcl" &&
            current.files[change.activePath]?.encoding !== "utf8")
        )
          return { ok: false, error: t("projectFileUnavailable") };
        const next = Object.freeze({
          ...current,
          activePath: change.activePath,
          revision: current.revision + 1,
        });
        projectRef.current = next;
        setProject(next);
        return { ok: true, project: next };
      }
      const source = change.source ?? current.source;
      const files = freezeProjectFiles(change.files ?? current.files);
      const activePath = change.activePath === undefined ? current.activePath : change.activePath;
      const fileSizes: Record<string, number> = Object.create(null);
      fileSizes["main.mcl"] = encoder.encode(source).byteLength;
      let totalBytes = fileSizes["main.mcl"];
      for (const [path, file] of Object.entries(files)) {
        const size =
          current.files[path] === file && file?.encoding === "utf8"
            ? (current.fileSizes[path] ?? fileSize(file))
            : fileSize(file);
        fileSizes[path] = size;
        totalBytes += size;
      }
      const next = Object.freeze({
        ...current,
        ...change,
        source,
        files,
        activePath,
        fileSizes: Object.freeze(fileSizes),
        totalBytes,
        revision: current.revision + 1,
      });
      const validationError = projectSnapshotError(next, fileSizes);
      if (validationError) return { ok: false, error: projectErrorMessage(validationError, t) };
      projectRef.current = next;
      setProject(next);
      return { ok: true, project: next };
    },
    [t],
  );

  const replace = useCallback(
    (source: string, files: Record<string, ProjectFile>, activePath = "main.mcl") => {
      return commit({ source, files: copyProjectFiles(files), activePath });
    },
    [commit],
  );

  const setFileContent = useCallback(
    (path: string, content: string): ProjectMutation => {
      const current = projectRef.current;
      if (path !== "main.mcl" && current.files[path]?.encoding !== "utf8")
        return { ok: false, error: t("projectFileNotEditable") };
      if (path === "main.mcl") return commit({ source: content });
      const files = Object.assign(Object.create(null), current.files) as Record<
        string,
        ProjectFile
      >;
      files[path] = { encoding: "utf8", content };
      return commit({ files });
    },
    [commit, t],
  );

  const setFiles = useCallback(
    (files: Record<string, ProjectFile>) => commit({ files: copyProjectFiles(files) }),
    [commit],
  );
  const select = useCallback(
    (activePath: string) => {
      const result = commit({ activePath });
      return result.ok ? result.project : projectRef.current;
    },
    [commit],
  );

  const createFile = useCallback(
    (path: string): ProjectMutation => {
      const current = projectRef.current;
      if (
        !isValidProjectPath(path) ||
        path === "main.mcl" ||
        !isValidProjectFileSet(["main.mcl", ...Object.keys(current.files), path])
      ) {
        return { ok: false, error: t("projectFilePathInvalid") };
      }
      if (Object.keys(current.files).length + 1 >= projectLimits.projectFiles) {
        return {
          ok: false,
          error: t("projectFileLimit", { count: projectLimits.projectFiles }),
        };
      }
      const files = Object.assign(Object.create(null), current.files) as Record<
        string,
        ProjectFile
      >;
      files[path] = { encoding: "utf8", content: "" };
      return commit({ files, activePath: path });
    },
    [commit, t],
  );

  const renameFile = useCallback(
    async (path: string, nextPath: string): Promise<ProjectMutation> => {
      const current = projectRef.current;
      const otherPaths = Object.keys(current.files).filter((existing) => existing !== path);
      if (
        !Object.hasOwn(current.files, path) ||
        !isValidProjectPath(nextPath) ||
        nextPath === "main.mcl" ||
        !isValidProjectFileSet(["main.mcl", ...otherPaths, nextPath])
      ) {
        return { ok: false, error: t("projectFilePathInvalid") };
      }
      const files = Object.assign(Object.create(null), current.files) as Record<
        string,
        ProjectFile
      >;
      if (path.endsWith(".mcl")) {
        let edits: PlaygroundRenameEdit[];
        try {
          edits = await renameFileImports(current.source, current.files, path, nextPath);
        } catch (error) {
          return {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
        if (projectRef.current !== current)
          return {
            ok: false,
            error: t("projectRenameStale"),
          };
        const sources = new Map<string, string>([["main.mcl", current.source]]);
        for (const [filePath, file] of Object.entries(current.files))
          if (filePath.endsWith(".mcl") && file.encoding === "utf8")
            sources.set(filePath, file.content);
        for (const filePath of new Set(edits.map((edit) => edit.path))) {
          const source = sources.get(filePath);
          if (source === undefined)
            return { ok: false, error: t("projectImportTargetMissing", { path: filePath }) };
          const updated = applyImportEdits(source, edits, filePath);
          if (updated === undefined)
            return { ok: false, error: t("projectImportRangeInvalid", { path: filePath }) };
          sources.set(filePath, updated);
        }
        const updatedSource = sources.get("main.mcl") ?? current.source;
        for (const [filePath, content] of sources)
          if (filePath !== "main.mcl" && filePath !== path && current.files[filePath])
            files[filePath] = { encoding: "utf8", content };
        const movedSource = sources.get(path);
        if (movedSource !== undefined) files[path] = { encoding: "utf8", content: movedSource };
        const movedFile = files[path];
        if (!movedFile) return { ok: false, error: t("projectFileMissing") };
        files[nextPath] = movedFile;
        delete files[path];
        const result = commit({
          source: updatedSource,
          files,
          activePath: current.activePath === path ? nextPath : current.activePath,
        });
        return result;
      }
      const movedFile = files[path];
      if (!movedFile) return { ok: false, error: t("projectFileMissing") };
      files[nextPath] = movedFile;
      delete files[path];
      return commit({
        files,
        activePath: current.activePath === path ? nextPath : current.activePath,
      });
    },
    [commit, renameFileImports, t],
  );

  const deleteFile = useCallback(
    (path: string): ProjectMutation => {
      const current = projectRef.current;
      if (path === "main.mcl" || !Object.hasOwn(current.files, path))
        return { ok: false, error: t("projectFileMissing") };
      const files = Object.assign(Object.create(null), current.files) as Record<
        string,
        ProjectFile
      >;
      delete files[path];
      return commit({
        files,
        activePath: current.activePath === path ? "main.mcl" : current.activePath,
      });
    },
    [commit, t],
  );

  return {
    project,
    projectRef,
    replace,
    setFileContent,
    setFiles,
    select,
    createFile,
    renameFile,
    deleteFile,
  };
}
