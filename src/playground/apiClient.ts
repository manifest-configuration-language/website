import {
  createMclRuntime,
  MclRuntimeError,
  type MclProject,
  type ProjectFiles,
} from "@manifest-configuration-language/browser";
import type { PlaygroundClient, PlaygroundDiagnostic, ProjectFile } from "./types";
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

export function createPlaygroundClient(): PlaygroundClient {
  const runtime = createMclRuntime({ operationTimeoutMs });
  const activeControllers = new Set<AbortController>();
  let projectSession: MclProject | undefined;

  function updateProject(
    source: string,
    files: Record<string, ProjectFile> = {},
    entrypoint = "main.mcl",
  ): MclProject {
    const snapshot = toProjectFiles(source, files, entrypoint);
    const nextProject = projectSession
      ? projectSession.update(snapshot)
      : runtime.openProject(snapshot);
    projectSession = nextProject;
    return nextProject;
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
    async warmUp() {
      const controller = beginRequest();
      try {
        await runtime.warmUp({ signal: controller.signal, timeoutMs: 30_000 });
      } finally {
        finishRequest(controller);
      }
    },
    async lint(source, revision, files) {
      const controller = beginRequest();
      try {
        const project = updateProject(source, files);
        const lint = await project.lint({
          signal: controller.signal,
          timeoutMs: operationTimeoutMs,
        });
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
    async complete(source, entrypoint, position, files) {
      const controller = beginRequest();
      try {
        const project = updateProject(source, files, entrypoint);
        const completion = await project.complete({
          entrypoint,
          position,
          signal: controller.signal,
          timeoutMs: operationTimeoutMs,
        });
        return completion.items;
      } finally {
        finishRequest(controller);
      }
    },
    async definition(source, entrypoint, position, files) {
      const controller = beginRequest();
      try {
        const project = updateProject(source, files, entrypoint);
        const result = await project.definition({
          entrypoint,
          position,
          signal: controller.signal,
          timeoutMs: operationTimeoutMs,
        });
        return result.location;
      } finally {
        finishRequest(controller);
      }
    },
    async hover(source, entrypoint, position, files) {
      const controller = beginRequest();
      try {
        const project = updateProject(source, files, entrypoint);
        const result = await project.hover({
          entrypoint,
          position,
          signal: controller.signal,
          timeoutMs: operationTimeoutMs,
        });
        return result.hover;
      } finally {
        finishRequest(controller);
      }
    },
    async rename(source, entrypoint, position, newName, files) {
      const controller = beginRequest();
      try {
        const project = updateProject(source, files, entrypoint);
        const result = await project.rename({
          entrypoint,
          position,
          newName,
          signal: controller.signal,
          timeoutMs: operationTimeoutMs,
        });
        return result.edits;
      } finally {
        finishRequest(controller);
      }
    },
    async references(source, entrypoint, position, files) {
      const controller = beginRequest();
      try {
        const project = updateProject(source, files, entrypoint);
        const result = await project.references({
          entrypoint,
          position,
          signal: controller.signal,
          timeoutMs: operationTimeoutMs,
        });
        return result.references;
      } finally {
        finishRequest(controller);
      }
    },
    async run(source, revision, files) {
      const controller = beginRequest();
      let diagnostics: PlaygroundDiagnostic[] | undefined;
      try {
        const project = updateProject(source, files);
        const lint = await project.lint({
          signal: controller.signal,
          timeoutMs: operationTimeoutMs,
        });
        diagnostics = lint.diagnostics;
        const rendered = await project.render({
          signal: controller.signal,
          timeoutMs: operationTimeoutMs,
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
    async format(source, revision) {
      const controller = beginRequest();
      try {
        const formatted = await runtime.format(source, {
          signal: controller.signal,
          timeoutMs: operationTimeoutMs,
        });
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
