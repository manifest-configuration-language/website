import {
  createMclRuntime,
  MclRuntimeError,
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
import { createProjectSession } from "./projectSession.js";

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

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && "name" in error && error.name === "AbortError"
  );
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
  const projectSession = createProjectSession((files) => runtime.openProject(files));

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
        const project = projectSession.update(toProjectFiles(source, files));
        const lint = await project.run("lint", {
          signal: controller.signal,
          timeoutMs: operationTimeoutMs,
          priority,
        });
        return {
          requestId: revision,
          revision,
          ok: true,
          diagnostics: lint.diagnostics,
        };
      } catch (error) {
        if (isAbortError(error)) throw error;
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
        const project = projectSession.update(toProjectFiles(source, files, entrypoint));
        const completion = await project.run("completion", {
          entrypoint,
          position,
          signal: controller.signal,
          timeoutMs: operationTimeoutMs,
          priority,
        });
        return completion.items;
      } finally {
        finishRequest(controller);
      }
    },
    async definition(source, entrypoint, position, files, priority = "interactive") {
      const controller = beginRequest();
      try {
        const project = projectSession.update(toProjectFiles(source, files, entrypoint));
        const result = await project.run("definition", {
          entrypoint,
          position,
          signal: controller.signal,
          timeoutMs: operationTimeoutMs,
          priority,
        });
        return result.location;
      } finally {
        finishRequest(controller);
      }
    },
    async hover(source, entrypoint, position, files, priority = "interactive") {
      const controller = beginRequest();
      try {
        const project = projectSession.update(toProjectFiles(source, files, entrypoint));
        const result = await project.run("hover", {
          entrypoint,
          position,
          signal: controller.signal,
          timeoutMs: operationTimeoutMs,
          priority,
        });
        return result.hover;
      } finally {
        finishRequest(controller);
      }
    },
    async rename(source, entrypoint, position, newName, files, priority = "interactive") {
      const controller = beginRequest();
      try {
        const project = projectSession.update(toProjectFiles(source, files, entrypoint));
        const result = await project.run("rename", {
          entrypoint,
          position,
          newName,
          signal: controller.signal,
          timeoutMs: operationTimeoutMs,
          priority,
        });
        return result.edits;
      } finally {
        finishRequest(controller);
      }
    },
    async renameFileImports(source, files, oldPath, newPath) {
      const controller = beginRequest();
      try {
        const project = projectSession.update(toProjectFiles(source, files));
        const result = await project.run("renameFileImports", {
          oldPath,
          newPath,
          signal: controller.signal,
          timeoutMs: operationTimeoutMs,
          priority: "interactive",
        });
        return result.edits;
      } finally {
        finishRequest(controller);
      }
    },
    async references(source, entrypoint, position, files, priority = "interactive") {
      const controller = beginRequest();
      try {
        const project = projectSession.update(toProjectFiles(source, files, entrypoint));
        const result = await project.run("references", {
          entrypoint,
          position,
          signal: controller.signal,
          timeoutMs: operationTimeoutMs,
          priority,
        });
        return result.references;
      } finally {
        finishRequest(controller);
      }
    },
    async run(source, revision, files, priority = "interactive") {
      const controller = beginRequest();
      let diagnostics: PlaygroundDiagnostic[] | undefined;
      try {
        const project = projectSession.update(toProjectFiles(source, files));
        const lint = await project.run("lint", {
          signal: controller.signal,
          timeoutMs: operationTimeoutMs,
          priority,
        });
        diagnostics = lint.diagnostics;
        const rendered = await project.run("render", {
          signal: controller.signal,
          timeoutMs: operationTimeoutMs,
          priority,
        });
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
        for (const [path, content] of Object.entries(projectSession.files)) {
          if (path !== entrypoint) projectFilesForFormat[path] = content;
        }
        projectFilesForFormat[entrypoint] = source;
        const runtimeProject = projectSession.update(projectFilesForFormat);
        const result = await runtimeProject.run("format", {
          entrypoint,
          signal: controller.signal,
          timeoutMs: operationTimeoutMs,
          priority,
        });
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
