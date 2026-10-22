import {
  createMclRuntime,
  MclRuntimeError,
  type ProjectFiles,
} from "@manifest-configuration-language/browser";
import type { PlaygroundClient, PlaygroundDiagnostic, PlaygroundReply, ProjectFile } from "./types";
import { readProject } from "./projectFiles.js";

const operationTimeoutMs = 10_000;

function toProjectFiles(source: string, files: Record<string, ProjectFile> = {}): ProjectFiles {
  const project = Object.create(null) as Record<string, string | Uint8Array>;
  project["main.mcl"] = source;
  for (const [filePath, file] of Object.entries(files)) {
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
  let activeController: AbortController | undefined;

  function beginRequest(): AbortController {
    activeController?.abort();
    activeController = new AbortController();
    return activeController;
  }

  return {
    loadProject(files) {
      return readProject(files);
    },
    async run(source, revision, files) {
      const controller = beginRequest();
      try {
        const project = runtime.openProject(toProjectFiles(source, files));
        const lint = await project.lint({
          signal: controller.signal,
          timeoutMs: operationTimeoutMs,
        });
        const rendered = await project.render({
          signal: controller.signal,
          timeoutMs: operationTimeoutMs,
        });
        return {
          requestId: revision,
          revision,
          ok: true,
          diagnostics: lint.diagnostics,
          result: { yaml: rendered.yaml, artifacts: rendered.artifacts },
        };
      } catch (error) {
        return { requestId: revision, revision, ok: false, error: toError(error) };
      } finally {
        if (activeController === controller) activeController = undefined;
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
        if (activeController === controller) activeController = undefined;
      }
    },
    cancel() {
      activeController?.abort();
      activeController = undefined;
    },
    dispose() {
      activeController?.abort();
      activeController = undefined;
      runtime.dispose();
    },
  };
}
