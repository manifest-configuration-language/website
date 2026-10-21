import type {
  PlaygroundClient,
  PlaygroundReply,
  PlaygroundRequest,
  PlaygroundWorkerRequest,
  ProjectFile,
} from "./types";

type WorkerMessage =
  | { type: "ready" }
  | { type: "result"; response: PlaygroundReply }
  | { type: "failure"; message: string };

type PendingRequest = {
  request: PlaygroundRequest;
  resolve: (reply: PlaygroundReply) => void;
  reject: (error: Error) => void;
  timeout: number;
};

export function createPlaygroundClient(): PlaygroundClient {
  let worker: Worker | undefined;
  let ready: Promise<void> | undefined;
  let rejectReady: ((error: Error) => void) | undefined;
  let requestId = 0;
  let pending: PendingRequest | undefined;

  function terminate(reason: Error): void {
    worker?.terminate();
    worker = undefined;
    ready = undefined;
    rejectReady?.(reason);
    rejectReady = undefined;
    if (pending) {
      window.clearTimeout(pending.timeout);
      pending.reject(reason);
      pending = undefined;
    }
  }

  function ensureWorker(): Promise<void> {
    if (ready) return ready;
    ready = new Promise<void>((resolve, reject) => {
      rejectReady = reject;
      worker = new Worker(new URL("./playground.worker.js", import.meta.url), { type: "module" });
      worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
        const message = event.data;
        if (message.type === "ready") {
          rejectReady = undefined;
          resolve();
        } else if (message.type === "failure") {
          terminate(new Error(message.message));
        } else if (
          pending?.request.requestId === message.response.requestId &&
          pending.request.revision === message.response.revision
        ) {
          window.clearTimeout(pending.timeout);
          pending.resolve(message.response);
          pending = undefined;
        }
      };
      worker.onerror = (event) => {
        event.preventDefault();
        terminate(new Error(`The WebAssembly worker failed to start: ${event.message}`));
      };
    });
    return ready;
  }

  async function invoke(
    operation: PlaygroundRequest["operation"],
    source: string,
    revision: number,
    files?: Record<string, ProjectFile>,
  ): Promise<PlaygroundReply> {
    await ensureWorker();
    if (!worker) throw new Error("The WebAssembly worker is unavailable.");
    return new Promise((resolve, reject) => {
      const request: PlaygroundRequest = {
        requestId: ++requestId,
        revision,
        operation,
        source,
        files,
      };
      const timeout = window.setTimeout(() => {
        terminate(new Error("Evaluation timed out. Run it again."));
      }, 4500);
      pending = { request, resolve, reject, timeout };
      const { files: projectFiles, ...requestMetadata } = request;
      const metadata = Object.create(null) as NonNullable<PlaygroundWorkerRequest["files"]>;
      const binaryFiles = Object.create(null) as Record<string, Uint8Array>;
      const transfer: ArrayBuffer[] = [];
      for (const [filePath, file] of Object.entries(projectFiles ?? {})) {
        if (file.encoding === "utf8") {
          metadata![filePath] = file;
          continue;
        }
        const bytes = new Uint8Array(file.bytes.byteLength);
        bytes.set(file.bytes);
        binaryFiles[filePath] = bytes;
        transfer.push(bytes.buffer as ArrayBuffer);
        metadata![filePath] = { encoding: "binary" };
      }
      const workerRequest: PlaygroundWorkerRequest = {
        ...requestMetadata,
        ...(projectFiles ? { files: metadata } : {}),
        ...(Object.keys(binaryFiles).length > 0 ? { binaryFiles } : {}),
      };
      worker?.postMessage(workerRequest, transfer);
    });
  }

  return {
    async run(source, revision, files) {
      if (pending) this.cancel();
      const lint = await invoke("lint", source, revision);
      if (!lint.ok) return lint;
      const rendered = await invoke("render", source, revision, files);
      if (rendered.ok)
        rendered.diagnostics = (lint as PlaygroundReply & { result?: unknown })
          .result as PlaygroundReply["diagnostics"];
      return rendered;
    },
    format(source, revision) {
      if (pending) this.cancel();
      return invoke("format", source, revision);
    },
    cancel() {
      if (worker) terminate(new Error("Evaluation cancelled."));
    },
    dispose() {
      if (worker) terminate(new Error("The playground was closed."));
    },
  };
}
