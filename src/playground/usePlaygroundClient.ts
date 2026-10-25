import { useCallback, useEffect, useRef } from "react";
import type { RefObject } from "react";
import type { RuntimeStatus } from "@manifest-configuration-language/browser";
import { createPlaygroundClient } from "./apiClient";
import type { PlaygroundClient } from "./types";

const measurementPrefix = "mcl.playground.";
const measurementLimit = 100;

type Options = {
  client: RefObject<PlaygroundClient | undefined>;
  startupReady: RefObject<boolean>;
  runAction: RefObject<() => void>;
  setWasmStatus: (status: RuntimeStatus | "waiting") => void;
  setError: (message: string) => void;
};

function recordMeasurement(
  name: string,
  start: number,
  duration: number,
  detail: Record<string, string | number | undefined>,
) {
  performance.measure(name, { start: Math.max(0, start), duration, detail });
  const entries = performance
    .getEntriesByType("measure")
    .filter((entry) => entry.name.startsWith(measurementPrefix))
    .sort((left, right) => left.startTime - right.startTime);
  for (const entry of entries.slice(0, Math.max(0, entries.length - measurementLimit)))
    performance.clearMeasures(entry.name);
}

export function usePlaygroundClient({
  client,
  startupReady,
  runAction,
  setWasmStatus,
  setError,
}: Options) {
  const runtimeReady = useRef(false);
  const initialRunIssued = useRef(false);
  const runInitialProjectIfReady = useCallback(() => {
    if (!startupReady.current || !runtimeReady.current || initialRunIssued.current) return;
    initialRunIssued.current = true;
    runAction.current();
  }, [runAction, startupReady]);

  useEffect(() => {
    let cancelled = false;
    let measurementSequence = 0;
    const createdClient = createPlaygroundClient(
      (event) => {
        if (cancelled) return;
        setWasmStatus(event.status);
        if (event.initializationDurationMs === undefined) return;
        const name = `${measurementPrefix}worker.initialization.${event.status}.${++measurementSequence}`;
        const end = performance.now();
        recordMeasurement(
          name,
          end - event.initializationDurationMs,
          event.initializationDurationMs,
          { status: event.status, workerGeneration: event.workerGeneration },
        );
      },
      (event) => {
        if (cancelled) return;
        const name = `${measurementPrefix}${event.operation}.${event.outcome}.${++measurementSequence}`;
        const end = performance.now();
        recordMeasurement(name, end - event.durationMs, event.durationMs, {
          operation: event.operation,
          outcome: event.outcome,
          queueWaitMs: event.queueWaitMs,
          executionDurationMs: event.executionDurationMs,
          wasmDurationMs: event.wasmDurationMs,
          workerGeneration: event.workerGeneration,
        });
      },
    );
    client.current = createdClient;
    void createdClient
      .warmUp("background")
      .then(() => {
        if (cancelled) return;
        runtimeReady.current = true;
        setWasmStatus("ready");
        runInitialProjectIfReady();
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      });

    return () => {
      cancelled = true;
      createdClient.dispose();
      client.current = undefined;
      runtimeReady.current = false;
      initialRunIssued.current = false;
    };
  }, [client, runInitialProjectIfReady, setError, setWasmStatus]);

  return { runInitialProjectIfReady };
}
