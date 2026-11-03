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
} from "./types";
import { readProject } from "./projectFiles.js";

const operationTimeoutMs = 10_000;
type ProjectOperation =
  | "parse"
  | "lint"
  | "format"
  | "check"
  | "evaluate"
  | "render"
  | "completion"
  | "definition"
  | "hover"
  | "references"
  | "rename"
  | "renameFileImports";

type ProjectRun = (
  operation: ProjectOperation,
  options?: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

type ProjectPatch = (changes: { set?: ProjectFiles; delete?: string[] }) => MclProject;

type PlaygroundRuntimeStatusEvent = RuntimeStatusEvent & {
  workerGeneration?: number;
  initializationDurationMs?: number;
};

type PlaygroundRuntimeOperationEvent = RuntimeOperationEvent & {
  queueWaitMs?: number;
  executionDurationMs?: number;
  wasmDurationMs?: number;
  workerGeneration?: number;
};

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
  onRuntimeStatus?: (event: PlaygroundRuntimeStatusEvent) => void,
  onRuntimeOperation?: (event: PlaygroundRuntimeOperationEvent) => void,
): PlaygroundClient {
  const runtime = createMclRuntime({
    operationTimeoutMs,
    onStatus: (event) => onRuntimeStatus?.(event),
    onOperation: (event) => onRuntimeOperation?.(event),
  });
  const activeControllers = new Set<AbortController>();
  let projectSession: MclProject | undefined;
  let projectFiles: ProjectFiles = Object.create(null) as ProjectFiles;

  function updateProject(
    source: string,
    files: Record<string, ProjectFile> = {},
    entrypoint = "main.mcl",
  ): MclProject {
    return updateProjectSnapshot(toProjectFiles(source, files, entrypoint));
  }

  function updateProjectSnapshot(snapshot: ProjectFiles): MclProject {
    if (!projectSession) {
      projectSession = runtime.openProject(snapshot);
      projectFiles = snapshot;
      return projectSession;
    }

    const set = Object.create(null) as Record<string, string | Uint8Array>;
    const deleted = Object.keys(projectFiles).filter((path) => !Object.hasOwn(snapshot, path));
    for (const [path, content] of Object.entries(snapshot)) {
      const previous = projectFiles[path];
      if (previous === undefined || !sameFileValue(previous, content)) set[path] = content;
    }
    const patch = Reflect.get(projectSession, "patch") as ProjectPatch | undefined;
    const update = Reflect.get(projectSession, "update") as
      | ((files: ProjectFiles) => MclProject)
      | undefined;
    const nextProject = patch
      ? patch.call(projectSession, { set, delete: deleted })
      : update?.call(projectSession, snapshot);
    if (!nextProject) throw new Error("The Browser SDK cannot update this project snapshot");
    projectSession = nextProject;
    projectFiles = snapshot;
    return nextProject;
  }

  async function runProject(
    project: MclProject,
    operation: ProjectOperation,
    options: Record<string, unknown> = {},
  ): Promise<MclResult> {
    const run = Reflect.get(project, "run") as ProjectRun | undefined;
    if (run) return run.call(project, operation, options) as Promise<MclResult>;

    const legacyMethod = operation === "completion" ? "complete" : operation;
    const method = Reflect.get(project, legacyMethod) as
      | ((options: unknown) => Promise<unknown>)
      | undefined;
    if (!method) throw new Error(`The Browser SDK does not support the ${operation} operation`);
    return (await method.call(project, options)) as MclResult;
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
        const project = updateProject(source, files);
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
        const project = updateProject(source, files, entrypoint);
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
        const project = updateProject(source, files, entrypoint);
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
        const project = updateProject(source, files, entrypoint);
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
        const project = updateProject(source, files, entrypoint);
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
        const project = updateProject(source, files);
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
        const project = updateProject(source, files, entrypoint);
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
        const project = updateProject(source, files);
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
    async format(source, revision, priority = "interactive") {
      const controller = beginRequest();
      try {
        const project = updateProjectSnapshot({ ...projectFiles, "main.mcl": source });
        const formatted = (await runProject(project, "format", {
          signal: controller.signal,
          timeoutMs: operationTimeoutMs,
          priority,
        })) as Extract<MclResult, { operation: "format" }>;
        return {
          requestId: revision,
          revision,
          ok: true,
          result: { source: formatted.source },
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
