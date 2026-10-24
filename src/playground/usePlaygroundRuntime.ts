import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { PlaygroundClient, PlaygroundReply } from "./types";
import type { PlaygroundProject } from "./usePlaygroundProject";

type PendingLint = { source: string; revision: number };

function isAbortError(cause: unknown): boolean {
  return cause instanceof Error && cause.name === "AbortError";
}

function isAbortReply(result: PlaygroundReply): boolean {
  return (
    result.error?.code === "MCL-WASM-RUNTIME" &&
    result.error.message === "The operation was aborted"
  );
}

type Options = {
  client: RefObject<PlaygroundClient | undefined>;
  project: RefObject<PlaygroundProject>;
  revision: RefObject<number>;
  onLint: (result: PlaygroundReply, revision: number) => void;
  onWasmReady: () => void;
};

export function usePlaygroundRuntime({ client, project, revision, onLint, onWasmReady }: Options) {
  const renderInFlight = useRef(false);
  const requestCount = useRef(0);
  const pendingLint = useRef<PendingLint | undefined>(undefined);
  const lintTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const flushPendingLintRef = useRef<() => void>(() => {});
  const [renderPending, setRenderPending] = useState(false);

  const trackRequest = useCallback(async <T>(request: Promise<T>) => {
    requestCount.current += 1;
    try {
      return await request;
    } finally {
      requestCount.current -= 1;
      flushPendingLintRef.current();
    }
  }, []);

  const scheduleLint = useCallback(
    (source: string, requestRevision: number) => {
      if (lintTimer.current) clearTimeout(lintTimer.current);
      if (renderInFlight.current || requestCount.current > 0) {
        pendingLint.current = { source, revision: requestRevision };
        return;
      }
      lintTimer.current = setTimeout(async () => {
        lintTimer.current = undefined;
        if (requestRevision !== revision.current) return;
        if (renderInFlight.current || requestCount.current > 0) {
          pendingLint.current = { source, revision: requestRevision };
          return;
        }
        try {
          const request = client.current?.lint(source, requestRevision, project.current.files);
          const result = request ? await trackRequest(request) : undefined;
          if (result && requestRevision === revision.current && !isAbortReply(result)) {
            onWasmReady();
            onLint(result, requestRevision);
          }
        } catch (cause) {
          if (requestRevision !== revision.current || isAbortError(cause)) return;
          onLint(
            {
              requestId: requestRevision,
              revision: requestRevision,
              ok: false,
              error: {
                code: "MCL-WASM-RUNTIME",
                message: cause instanceof Error ? cause.message : String(cause),
                severity: "error",
                line: 1,
                column: 1,
              },
            },
            requestRevision,
          );
        }
      }, 400);
    },
    [client, onLint, onWasmReady, project, revision, trackRequest],
  );

  const flushPendingLint = useCallback(() => {
    if (renderInFlight.current || requestCount.current > 0) return;
    const pending = pendingLint.current;
    pendingLint.current = undefined;
    if (pending && pending.revision === revision.current)
      scheduleLint(pending.source, pending.revision);
  }, [revision, scheduleLint]);
  flushPendingLintRef.current = flushPendingLint;

  const run = useCallback(
    (source: string, requestRevision: number): Promise<PlaygroundReply> | undefined => {
      const activeClient = client.current;
      if (!activeClient || renderInFlight.current) return undefined;
      renderInFlight.current = true;
      setRenderPending(true);
      return (async () => {
        try {
          return await trackRequest(
            activeClient.run(source, requestRevision, project.current.files),
          );
        } finally {
          renderInFlight.current = false;
          setRenderPending(false);
          flushPendingLint();
        }
      })();
    },
    [client, flushPendingLint, project, trackRequest],
  );

  const isRendering = useCallback(() => renderInFlight.current, []);

  useEffect(
    () => () => {
      if (lintTimer.current) clearTimeout(lintTimer.current);
    },
    [],
  );

  return { isRendering, renderPending, run, scheduleLint, trackRequest };
}
