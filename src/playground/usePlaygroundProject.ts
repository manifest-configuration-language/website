import { useCallback, useRef, useState } from "react";
import { isValidProjectFileSet, isValidProjectPath, projectLimits } from "./projectValidation.js";
import type { ProjectFile } from "./types";

export type PlaygroundProject = {
  source: string;
  files: Record<string, ProjectFile>;
  activePath: string;
  revision: number;
  fileSizes: Record<string, number>;
  totalBytes: number;
};

type ProjectMutation = { ok: true; project: PlaygroundProject } | { ok: false; error: string };

const encoder = new TextEncoder();

function fileSize(file: ProjectFile): number {
  return file.encoding === "utf8" ? encoder.encode(file.content).byteLength : file.bytes.byteLength;
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

export function usePlaygroundProject(initialSource: string) {
  const [project, setProject] = useState<PlaygroundProject>(() => ({
    source: initialSource,
    files: {},
    activePath: "main.mcl",
    revision: 0,
    ...projectFileSizes(initialSource, {}),
  }));
  const projectRef = useRef(project);

  const commit = useCallback((change: Partial<Omit<PlaygroundProject, "revision">>) => {
    const next = { ...projectRef.current, ...change, revision: projectRef.current.revision + 1 };
    projectRef.current = next;
    setProject(next);
    return next;
  }, []);

  const replace = useCallback(
    (source: string, files: Record<string, ProjectFile>, activePath = "main.mcl") => {
      return commit({ source, files, activePath, ...projectFileSizes(source, files) });
    },
    [commit],
  );

  const setFileContent = useCallback(
    (path: string, content: string) => {
      const current = projectRef.current;
      const size = encoder.encode(content).byteLength;
      const previousSize = current.fileSizes[path] ?? 0;
      const fileSizes = Object.assign(Object.create(null), current.fileSizes) as Record<
        string,
        number
      >;
      fileSizes[path] = size;
      if (path === "main.mcl")
        return commit({
          source: content,
          fileSizes,
          totalBytes: current.totalBytes - previousSize + size,
        });
      const previous = current.files[path];
      const files = Object.assign(Object.create(null), current.files) as Record<
        string,
        ProjectFile
      >;
      files[path] = { encoding: "utf8", content };
      return commit({
        files,
        fileSizes,
        totalBytes: current.totalBytes - (previous ? previousSize : 0) + size,
      });
    },
    [commit],
  );

  const setFiles = useCallback(
    (files: Record<string, ProjectFile>) =>
      commit({ files, ...projectFileSizes(projectRef.current.source, files) }),
    [commit],
  );
  const select = useCallback((activePath: string) => commit({ activePath }), [commit]);

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
      const fileSizes = Object.assign(Object.create(null), current.fileSizes) as Record<
        string,
        number
      >;
      fileSizes[path] = 0;
      return { ok: true, project: commit({ files, fileSizes, activePath: path }) };
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
      const fileSizes = Object.assign(Object.create(null), current.fileSizes) as Record<
        string,
        number
      >;
      fileSizes[nextPath] = fileSizes[path];
      delete fileSizes[path];
      return {
        ok: true,
        project: commit({
          files,
          fileSizes,
          activePath: current.activePath === path ? nextPath : current.activePath,
        }),
      };
    },
    [commit],
  );

  const deleteFile = useCallback(
    (path: string): ProjectMutation => {
      const current = projectRef.current;
      if (path === "main.mcl" || !Object.hasOwn(current.files, path))
        return { ok: false, error: "ファイルが見つかりません" };
      const files = Object.assign(Object.create(null), current.files) as Record<
        string,
        ProjectFile
      >;
      delete files[path];
      const fileSizes = Object.assign(Object.create(null), current.fileSizes) as Record<
        string,
        number
      >;
      delete fileSizes[path];
      return {
        ok: true,
        project: commit({
          files,
          fileSizes,
          activePath: current.activePath === path ? "main.mcl" : current.activePath,
          totalBytes: current.totalBytes - current.fileSizes[path],
        }),
      };
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
