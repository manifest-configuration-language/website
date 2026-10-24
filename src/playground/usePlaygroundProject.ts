import { useCallback, useRef, useState } from "react";
import { isValidProjectPath, projectLimits } from "./projectValidation.js";
import type { ProjectFile } from "./types";

export type PlaygroundProject = {
  source: string;
  files: Record<string, ProjectFile>;
  activePath: string;
  revision: number;
};

type ProjectMutation = { ok: true; project: PlaygroundProject } | { ok: false; error: string };

function pathConflicts(path: string, paths: string[]) {
  return paths.some(
    (existing) =>
      existing === path || existing.startsWith(`${path}/`) || path.startsWith(`${existing}/`),
  );
}

export function usePlaygroundProject(initialSource: string) {
  const [project, setProject] = useState<PlaygroundProject>({
    source: initialSource,
    files: {},
    activePath: "main.mcl",
    revision: 0,
  });
  const projectRef = useRef(project);

  const commit = useCallback((change: Partial<Omit<PlaygroundProject, "revision">>) => {
    const next = { ...projectRef.current, ...change, revision: projectRef.current.revision + 1 };
    projectRef.current = next;
    setProject(next);
    return next;
  }, []);

  const replace = useCallback(
    (source: string, files: Record<string, ProjectFile>, activePath = "main.mcl") => {
      return commit({ source, files, activePath });
    },
    [commit],
  );

  const setFileContent = useCallback(
    (path: string, content: string) => {
      const current = projectRef.current;
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

  const setFiles = useCallback((files: Record<string, ProjectFile>) => commit({ files }), [commit]);
  const select = useCallback((activePath: string) => commit({ activePath }), [commit]);

  const createFile = useCallback(
    (path: string): ProjectMutation => {
      const current = projectRef.current;
      if (
        !isValidProjectPath(path) ||
        path === "main.mcl" ||
        pathConflicts(path, Object.keys(current.files))
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
      return { ok: true, project: commit({ files, activePath: path }) };
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
        pathConflicts(nextPath, otherPaths)
      ) {
        return { ok: false, error: "使用できないファイルパスです" };
      }
      const files = Object.assign(Object.create(null), current.files) as Record<
        string,
        ProjectFile
      >;
      files[nextPath] = files[path];
      delete files[path];
      return {
        ok: true,
        project: commit({
          files,
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
      return {
        ok: true,
        project: commit({
          files,
          activePath: current.activePath === path ? "main.mcl" : current.activePath,
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
