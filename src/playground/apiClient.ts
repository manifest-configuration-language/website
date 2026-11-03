import {
  createMclRuntime,
  MclRuntimeError,
  type MclProject,
  type MclResult,
  type ProjectFiles,
  type RuntimeOperationEvent,
  type RuntimeStatusEvent,
} from "@manifest-configuration-language/browser";
import type {
  PlaygroundClient,
  PlaygroundDiagnostic,
  PlaygroundPriority,
  ProjectFile,
} from "./types.js";
import { readProject } from "./projectFiles.js";

const operationTimeoutMs = 10_000;

function toProjectFiles(
  source: string,
  files: Record<string, ProjectFile> = {},
  entrypoint = "main.mcl",
): ProjectFiles {
  const project = Object.create(null) as Record<string, string | Uint8Array>;
  project[entrypoint] = source;
  for (const [filePath, file] of Object.entries(files)) {
    if (filePath === entrypoint) continue;
    project[filePath] = file.encoding === "utf8" ? file.content : file.bytes;
  }
  return project;
}

function sameFileValue(left: string | Uint8Array, right: string | Uint8Array): boolean {
  return left === right;
}

function toError(error: unknown): PlaygroundDiagnostic {
  if (error instanceof MclRuntimeError) {
    return {
      code: error.code,
      message: error.message,
      severity: "error",
      line: error.line ?? 1,
      column: error.column ?? 1,
      ...(error.path === undefined ? {} : { path: error.path }),
      ...(error.endLine === undefined ? {} : { endLine: error.endLine }),
      ...(error.endColumn === undefined ? {} : { endColumn: error.endColumn }),
      ...(error.related === undefined ? {} : { related: error.related }),
    };
  }
  return {
    code: "MCL-WASM-RUNTIME",
    message: error instanceof Error ? error.message : String(error),
    severity: "error",
    line: 1,
    column: 1,
  };
}

export function createPlaygroundClient(
  onRuntimeStatus?: (event: RuntimeStatusEvent) => void,
  onRuntimeOperation?: (event: RuntimeOperationEvent) => void,
): PlaygroundClient {
  const runtime = createMclRuntime({
    operationTimeoutMs,
    onStatus: (event) => onRuntimeStatus?.(event),
    onOperation: (event) => onRuntimeOperation?.(event),
  });
  const activeControllers = new Set<AbortController>();
  let projectSession: MclProject | undefined;
  let projectFiles: ProjectFiles = Object.create(null) as ProjectFiles;

  function updateProjectSnapshot(snapshot: ProjectFiles): MclProject {
    if (!projectSession) {
      projectSession = runtime.openProject(snapshot);
      projectFiles = snapshot;
      return projectSession;
    }

    const patch = projectSession.patch.bind(projectSession);
    const set = Object.create(null) as Record<string, string | Uint8Array>;
    const deleted: string[] = [];
    for (const [path, content] of Object.entries(snapshot)) {
      const previous = projectFiles[path];
      if (previous === undefined || !sameFileValue(previous, content)) set[path] = content;
    }
    for (const path of Object.keys(projectFiles)) {
      if (!Object.hasOwn(snapshot, path)) deleted.push(path);
    }
    const nextProject = patch({ set, delete: deleted });
    projectFiles = snapshot;
    return nextProject;
  }

  async function runProject(
    project: MclProject,
    operation: string,
    options?: Record<string, unknown>,
  ): Promise<MclResult> {
    return project.run(operation as string, options) as Promise<MclResult>;
  }

  function beginRequest(): AbortController {
    const controller = new AbortController();
    activeControllers.add(controller);
    return controller;
  }

  function finishRequest(controller: AbortController): void {
    activeControllers.delete(controller);
  }

  return {
    loadProject(files) {
      return readProject(files);
    },
    async warmUp(priority: PlaygroundPriority = "background") {
      const controller = beginRequest();
      try {
        await runtime.warmUp({ signal: controller.signal, timeoutMs: 30_000, priority });
      } finally {
        finishRequest(controller);
      }
    },
    async lint(source, revision, files, priority = "background") {
      const controller = beginRequest();
      try {
        const project = updateProjectSnapshot(toProjectFiles(source, files));
        const lint = (await runProject(project, "lint", {
          signal: controller.signal,
          timeoutMs: operationTimeoutMs,
          priority,
        })) as Extract<MclResult, { operation: "lint" }>;
        return {
          requestId: revision,
          revision,
          ok: true,
          diagnostics: lint.diagnostics,
        };
      } catch (error) {
        return {
          requestId: revision,
          revision,
          ok: false,
          error: toError(error),
        };
      } finally {
        finishRequest(controller);
      }
    },
    async complete(source, entrypoint, position, files, priority = "interactive") {
      const controller = beginRequest();
      try {
        const project = updateProjectSnapshot(toProjectFiles(source, files, entrypoint));
        const completion = (await runProject(project, "completion", {
          entrypoint,
          position,
          signal: controller.signal,
          timeoutMs: operationTimeoutMs,
          priority,
        })) as Extract<MclResult, { operation: "completion" }>;
        return completion.items;
      } finally {
        finishRequest(controller);
      }
    },
    async definition(source, entrypoint, position, files, priority = "interactive") {
      const controller = beginRequest();
      try {
        const project = updateProjectSnapshot(toProjectFiles(source, files, entrypoint));
        const result = (await runProject(project, "definition", {
          entrypoint,
          position,
          signal: controller.signal,
          timeoutMs: operationTimeoutMs,
          priority,
        })) as Extract<MclResult, { operation: "definition" }>;
        return result.location;
      } finally {
        finishRequest(controller);
      }
    },
    async hover(source, entrypoint, position, files, priority = "interactive") {
      const controller = beginRequest();
      try {
        const project = updateProjectSnapshot(toProjectFiles(source, files, entrypoint));
        const result = (await runProject(project, "hover", {
          entrypoint,
          position,
          signal: controller.signal,
          timeoutMs: operationTimeoutMs,
          priority,
        })) as Extract<MclResult, { operation: "hover" }>;
        return result.hover;
      } finally {
        finishRequest(controller);
      }
    },
    async rename(source, entrypoint, position, newName, files, priority = "interactive") {
      const controller = beginRequest();
      try {
        const project = updateProjectSnapshot(toProjectFiles(source, files, entrypoint));
        const result = (await runProject(project, "rename", {
          entrypoint,
          position,
          newName,
          signal: controller.signal,
          timeoutMs: operationTimeoutMs,
          priority,
        })) as Extract<MclResult, { operation: "rename" }>;
        return result.edits;
      } finally {
        finishRequest(controller);
      }
    },
    async renameFileImports(source, files, oldPath, newPath) {
      const controller = beginRequest();
      try {
        const project = updateProjectSnapshot(toProjectFiles(source, files));
        const result = (await runProject(project, "renameFileImports", {
          oldPath,
          newPath,
          signal: controller.signal,
          timeoutMs: operationTimeoutMs,
          priority: "interactive",
        })) as Extract<MclResult, { operation: "renameFileImports" }>;
        return result.edits;
      } finally {
        finishRequest(controller);
      }
    },
    async references(source, entrypoint, position, files, priority = "interactive") {
      const controller = beginRequest();
      try {
        const project = updateProjectSnapshot(toProjectFiles(source, files, entrypoint));
        const result = (await runProject(project, "references", {
          entrypoint,
          position,
          signal: controller.signal,
          timeoutMs: operationTimeoutMs,
          priority,
        })) as Extract<MclResult, { operation: "references" }>;
        return result.references;
      } finally {
        finishRequest(controller);
      }
    },
    async run(source, revision, files, priority = "interactive") {
      const controller = beginRequest();
      let diagnostics: PlaygroundDiagnostic[] | undefined;
      try {
        const project = updateProjectSnapshot(toProjectFiles(source, files));
        const lint = (await runProject(project, "lint", {
          signal: controller.signal,
          timeoutMs: operationTimeoutMs,
          priority,
        })) as Extract<MclResult, { operation: "lint" }>;
        diagnostics = lint.diagnostics;
        const rendered = (await runProject(project, "render", {
          signal: controller.signal,
          timeoutMs: operationTimeoutMs,
          priority,
        })) as Extract<MclResult, { operation: "render" }>;
        return {
          requestId: revision,
          revision,
          ok: true,
          diagnostics: lint.diagnostics,
          result: {
            yaml: rendered.yaml,
            artifacts: rendered.artifacts,
            sourceMap: rendered.sourceMap,
          },
        };
      } catch (error) {
        return {
          requestId: revision,
          revision,
          ok: false,
          ...(diagnostics === undefined ? {} : { diagnostics }),
          error: toError(error),
        };
      } finally {
        finishRequest(controller);
      }
    },
    async format(source, revision, entrypoint = "main.mcl", priority = "interactive") {
      const controller = beginRequest();
      try {
        const projectFilesForFormat = Object.create(null) as Record<string, string | Uint8Array>;
        for (const [path, content] of Object.entries(projectFiles)) {
          if (path !== entrypoint) projectFilesForFormat[path] = content;
        }
        projectFilesForFormat[entrypoint] = source;
        const runtimeProject = runtime.openProject(projectFilesForFormat);
        const result = (await runProject(runtimeProject, "format", {
          signal: controller.signal,
          timeoutMs: operationTimeoutMs,
          priority,
        })) as Extract<MclResult, { operation: "format" }>;
        return {
          requestId: revision,
          revision,
          ok: true,
          result: { source: result.source },
        };
      } catch (error) {
        return { requestId: revision, revision, ok: false, error: toError(error) };
      } finally {
        finishRequest(controller);
      }
    },
    cancel() {
      for (const controller of activeControllers) controller.abort();
      activeControllers.clear();
    },
    dispose() {
      for (const controller of activeControllers) controller.abort();
      activeControllers.clear();
      runtime.dispose();
    },
  };
}
