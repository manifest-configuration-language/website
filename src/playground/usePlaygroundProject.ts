import { useCallback, useRef, useState } from "react";
import { parser as mclParser } from "@manifest-configuration-language/language";
import {
  isValidProjectFileSet,
  isValidProjectPath,
  projectLimits,
  projectSnapshotError,
  projectSnapshotErrorMessage,
} from "./projectValidation.js";
import type { ProjectFile } from "./types";

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

type MclImport = { path: string; from: number; to: number };

function parseMclImports(source: string, sourcePath: string): MclImport[] | string {
  const cursor = mclParser.parse(source).cursor();
  const imports: MclImport[] = [];
  do {
    if (cursor.name !== "ImportDeclaration") continue;
    let literalRange: { from: number; to: number } | undefined;
    let malformed = false;
    if (cursor.firstChild()) {
      do {
        if ((cursor.name as string) === "QuotedString")
          literalRange = { from: cursor.from, to: cursor.to };
        if (cursor.type.isError) malformed = true;
      } while (cursor.nextSibling());
      cursor.parent();
    }
    if (!literalRange) {
      if (malformed)
        return `MCLのimportを解析できないため、ファイル名を変更できません: ${sourcePath}`;
      continue;
    }
    const raw = source.slice(literalRange.from, literalRange.to);
    if (raw.startsWith('"std:')) {
      imports.push({ path: "std:", from: literalRange.from, to: literalRange.to });
      continue;
    }
    let path: unknown;
    try {
      path = JSON.parse(raw);
    } catch {
      return `MCLのimportパスを解析できないため、ファイル名を変更できません: ${sourcePath}`;
    }
    if (typeof path !== "string")
      return `MCLのimportパスを解析できないため、ファイル名を変更できません: ${sourcePath}`;
    imports.push({ path, from: literalRange.from, to: literalRange.to });
  } while (cursor.next());
  return imports;
}

function resolveProjectImport(importerPath: string, importPath: string): string | undefined {
  if (!importPath || importPath.startsWith("std:") || importPath.startsWith("/")) return undefined;
  const segments = [...importerPath.split("/").slice(0, -1), ...importPath.split("/")];
  const resolved: string[] = [];
  for (const segment of segments) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (resolved.length === 0) return undefined;
      resolved.pop();
    } else {
      resolved.push(segment);
    }
  }
  return resolved.join("/");
}

function relativeProjectImport(importerPath: string, targetPath: string): string {
  const importerDirectory = importerPath.split("/").slice(0, -1);
  const targetSegments = targetPath.split("/");
  let common = 0;
  while (
    common < importerDirectory.length &&
    common < targetSegments.length &&
    importerDirectory[common] === targetSegments[common]
  )
    common += 1;
  return [
    ...Array.from({ length: importerDirectory.length - common }, () => ".."),
    ...targetSegments.slice(common),
  ].join("/");
}

function mclSources(source: string, files: Record<string, ProjectFile>) {
  return [
    { path: "main.mcl", content: source },
    ...Object.entries(files)
      .filter(([path, file]) => path.endsWith(".mcl") && file.encoding === "utf8")
      .map(([path, file]) => ({ path, content: file.encoding === "utf8" ? file.content : "" })),
  ];
}

function replaceImportPaths(
  source: string,
  replacements: Array<{ from: number; to: number; path: string }>,
) {
  return replacements
    .sort((left, right) => right.from - left.from)
    .reduce(
      (content, replacement) =>
        `${content.slice(0, replacement.from)}${JSON.stringify(replacement.path)}${content.slice(replacement.to)}`,
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

export function usePlaygroundProject(initialSource: string) {
  const [project, setProject] = useState<PlaygroundProject>(() => ({
    source: initialSource,
    files: {},
    activePath: "main.mcl",
    revision: 0,
    ...projectFileSizes(initialSource, {}),
  }));
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
          return { ok: false, error: "選択できるファイルがありません" };
        const next = { ...current, activePath: change.activePath, revision: current.revision + 1 };
        projectRef.current = next;
        setProject(next);
        return { ok: true, project: next };
      }
      const source = change.source ?? current.source;
      const files = change.files ?? current.files;
      const activePath = change.activePath === undefined ? current.activePath : change.activePath;
      const fileSizes: Record<string, number> = Object.create(null);
      fileSizes["main.mcl"] = encoder.encode(source).byteLength;
      let totalBytes = fileSizes["main.mcl"];
      for (const [path, file] of Object.entries(files)) {
        const size =
          current.files[path] === file
            ? (current.fileSizes[path] ?? fileSize(file))
            : fileSize(file);
        fileSizes[path] = size;
        totalBytes += size;
      }
      const next = {
        ...current,
        ...change,
        source,
        files,
        activePath,
        fileSizes,
        totalBytes,
        revision: current.revision + 1,
      };
      const validationError = projectSnapshotError(next, fileSizes);
      if (validationError)
        return { ok: false, error: projectSnapshotErrorMessage(validationError) };
      projectRef.current = next;
      setProject(next);
      return { ok: true, project: next };
    },
    [],
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
        return { ok: false, error: "編集できるファイルがありません" };
      if (path === "main.mcl") return commit({ source: content });
      const files = Object.assign(Object.create(null), current.files) as Record<
        string,
        ProjectFile
      >;
      files[path] = { encoding: "utf8", content };
      return commit({ files });
    },
    [commit],
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
        return { ok: false, error: "使用できないファイルパスです" };
      }
      if (Object.keys(current.files).length + 1 >= projectLimits.projectFiles) {
        return {
          ok: false,
          error: `プロジェクトのファイル数は${projectLimits.projectFiles}件までです`,
        };
      }
      const files = Object.assign(Object.create(null), current.files) as Record<
        string,
        ProjectFile
      >;
      files[path] = { encoding: "utf8", content: "" };
      return commit({ files, activePath: path });
    },
    [commit],
  );

  const renameFile = useCallback(
    (path: string, nextPath: string): ProjectMutation => {
      const current = projectRef.current;
      const otherPaths = Object.keys(current.files).filter((existing) => existing !== path);
      if (
        !Object.hasOwn(current.files, path) ||
        !isValidProjectPath(nextPath) ||
        nextPath === "main.mcl" ||
        !isValidProjectFileSet(["main.mcl", ...otherPaths, nextPath])
      ) {
        return { ok: false, error: "使用できないファイルパスです" };
      }
      const files = Object.assign(Object.create(null), current.files) as Record<
        string,
        ProjectFile
      >;
      files[nextPath] = files[path];
      delete files[path];
      let source = current.source;
      for (const mclSource of mclSources(current.source, current.files)) {
        const imports = parseMclImports(mclSource.content, mclSource.path);
        if (typeof imports === "string")
          return {
            ok: false,
            error: `MCLのimportを確認できないため、ファイル名を変更できません: ${mclSource.path}`,
          };
        const nextImporterPath = mclSource.path === path ? nextPath : mclSource.path;
        const replacements = imports.flatMap((entry) => {
          const resolved = resolveProjectImport(mclSource.path, entry.path);
          const targetPath =
            resolved === path
              ? nextPath
              : mclSource.path === path &&
                  resolved !== undefined &&
                  (resolved === "main.mcl" || Object.hasOwn(current.files, resolved))
                ? resolved
                : undefined;
          if (targetPath === undefined || entry.path.startsWith("std:")) return [];
          const nextImportPath = relativeProjectImport(nextImporterPath, targetPath);
          return nextImportPath === entry.path
            ? []
            : [{ from: entry.from, to: entry.to, path: nextImportPath }];
        });
        if (replacements.length === 0) continue;
        const updated = replaceImportPaths(mclSource.content, replacements);
        if (mclSource.path === "main.mcl") source = updated;
        else {
          const renamedSourcePath = mclSource.path === path ? nextPath : mclSource.path;
          files[renamedSourcePath] = { encoding: "utf8", content: updated };
        }
      }
      return commit({
        source,
        files,
        activePath: current.activePath === path ? nextPath : current.activePath,
      });
    },
    [commit],
  );

  const deleteFile = useCallback(
    (path: string): ProjectMutation => {
      const current = projectRef.current;
      if (path === "main.mcl" || !Object.hasOwn(current.files, path))
        return { ok: false, error: "ファイルが見つかりません" };
      for (const mclSource of mclSources(current.source, current.files)) {
        if (mclSource.path === path) continue;
        const imports = parseMclImports(mclSource.content, mclSource.path);
        if (typeof imports === "string")
          return {
            ok: false,
            error: `MCLのimportを確認できないため、ファイルを削除できません: ${mclSource.path}`,
          };
        if (imports.some((entry) => resolveProjectImport(mclSource.path, entry.path) === path))
          return {
            ok: false,
            error: `MCLからimportされているため、ファイルを削除できません: ${path}`,
          };
      }
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
    [commit],
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
