import { useCallback, useReducer, useRef, useState } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import type { EditorView } from "@codemirror/view";
import type { RuntimeStatus } from "@manifest-configuration-language/browser";
import { DraftConflictError } from "./usePlaygroundPersistence";
import { usePlaygroundRuntime } from "./usePlaygroundRuntime";
import type { PlaygroundClient, PlaygroundDiagnostic, PlaygroundReply } from "./types";
import type { PlaygroundProject } from "./usePlaygroundProject";

type RenderState = {
  reply?: PlaygroundReply;
  latestSuccess?: PlaygroundReply;
  previousYaml?: string;
  stale: boolean;
};

type RenderAction =
  | { type: "source-changed" }
  | { type: "project-replaced" }
  | { type: "started" }
  | { type: "succeeded"; reply: PlaygroundReply }
  | { type: "failed"; reply: PlaygroundReply };

const initialRenderState: RenderState = { stale: false };

function renderStateReducer(state: RenderState, action: RenderAction): RenderState {
  switch (action.type) {
    case "source-changed":
      return {
        ...state,
        reply: state.reply?.ok === false ? state.latestSuccess : state.reply,
        stale: state.latestSuccess?.result?.yaml !== undefined,
      };
    case "project-replaced":
      return initialRenderState;
    case "started":
      return {
        ...state,
        reply: undefined,
        stale: state.latestSuccess?.result?.yaml !== undefined,
      };
    case "succeeded":
      return {
        reply: action.reply,
        latestSuccess: action.reply,
        previousYaml: state.latestSuccess?.result?.yaml,
        stale: false,
      };
    case "failed":
      return {
        ...state,
        reply: action.reply,
        stale: state.latestSuccess?.result?.yaml !== undefined,
      };
  }
}

type Options = {
  client: RefObject<PlaygroundClient | undefined>;
  editor: RefObject<EditorView | undefined>;
  project: RefObject<PlaygroundProject>;
  startupReady: RefObject<boolean>;
  activePath: string;
  loadingProject: boolean;
  draftConflict: boolean;
  setBusy: (busy: boolean) => void;
  setError: (error: string) => void;
  setDiagnostics: Dispatch<SetStateAction<PlaygroundDiagnostic[]>>;
  setShowProblems: (show: boolean) => void;
  setShowDiff: (show: boolean) => void;
  setMobileView: (view: "editor" | "output" | "problems") => void;
};

export function usePlaygroundExecution({
  client,
  editor,
  project,
  startupReady,
  activePath,
  loadingProject,
  draftConflict,
  setBusy,
  setError,
  setDiagnostics,
  setShowProblems,
  setShowDiff,
  setMobileView,
}: Options) {
  const revision = useRef(0);
  const projectContentRevision = useRef(0);
  const renderedContentRevision = useRef<number | undefined>(undefined);
  const runAction = useRef<() => void>(() => {});
  const sourceChangeDispatched = useRef(false);
  const [renderState, dispatchRender] = useReducer(renderStateReducer, initialRenderState);
  const [wasmStatus, setWasmStatus] = useState<RuntimeStatus | "waiting">("waiting");
  const reply = renderState.reply;
  const staleYaml = renderState.stale ? renderState.latestSuccess?.result?.yaml : undefined;
  const previousYaml = renderState.previousYaml;

  const handleLintResult = useCallback(
    (result: PlaygroundReply) => {
      const currentDiagnostics = result.ok
        ? (result.diagnostics ?? [])
        : result.error
          ? [result.error]
          : [];
      setDiagnostics(currentDiagnostics);
    },
    [setDiagnostics],
  );
  const handleWasmReady = useCallback(() => setWasmStatus("ready"), []);
  const {
    isRendering,
    renderPending,
    run: runWasm,
    scheduleLint,
  } = usePlaygroundRuntime({
    client,
    project,
    revision,
    onLint: handleLintResult,
    onWasmReady: handleWasmReady,
  });

  const notifySourceChanged = useCallback(() => {
    const currentRevision = ++revision.current;
    projectContentRevision.current += 1;
    setDiagnostics((current: PlaygroundDiagnostic[]) => (current.length > 0 ? [] : current));
    if (!sourceChangeDispatched.current) {
      sourceChangeDispatched.current = true;
      dispatchRender({ type: "source-changed" });
    }
    setShowDiff(false);
    setBusy(false);
    if (startupReady.current) scheduleLint(project.current.source, currentRevision);
  }, [project, scheduleLint, setBusy, setDiagnostics, setShowDiff, startupReady]);

  const notifyProjectReplaced = useCallback(() => {
    dispatchRender({ type: "project-replaced" });
    sourceChangeDispatched.current = false;
    setShowDiff(false);
    projectContentRevision.current += 1;
    setBusy(false);
    const currentRevision = ++revision.current;
    setDiagnostics([]);
    if (startupReady.current) scheduleLint(project.current.source, currentRevision);
  }, [project, scheduleLint, setBusy, setDiagnostics, setShowDiff, startupReady]);

  const notifyInitialContentChanged = useCallback(() => {
    projectContentRevision.current += 1;
    revision.current += 1;
  }, []);

  const run = useCallback(
    async (focusOutput = true, priority: "interactive" | "background" = "interactive") => {
      if (!editor.current || !client.current || loadingProject || isRendering()) return;
      const currentRevision = ++revision.current;
      const request = runWasm(project.current.source, currentRevision, priority);
      if (!request) return;
      setBusy(true);
      setError("");
      sourceChangeDispatched.current = false;
      dispatchRender({ type: "started" });
      setShowDiff(false);
      try {
        const result = await request;
        if (currentRevision !== revision.current) return;
        setDiagnostics(result.diagnostics ?? (result.error ? [result.error] : []));
        if (result.ok) {
          renderedContentRevision.current = projectContentRevision.current;
          setShowProblems(false);
          if (focusOutput) setMobileView("output");
          setShowDiff(false);
          dispatchRender({ type: "succeeded", reply: { ...result, diagnostics: undefined } });
          sourceChangeDispatched.current = false;
        } else {
          setMobileView("problems");
          setShowProblems(true);
          dispatchRender({ type: "failed", reply: { ...result, diagnostics: undefined } });
          sourceChangeDispatched.current = false;
          if (result.error) setError(`${result.error.code}: ${result.error.message}`);
        }
      } catch (cause) {
        if (currentRevision === revision.current)
          setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (currentRevision === revision.current) setBusy(false);
      }
    },
    [
      client,
      editor,
      isRendering,
      loadingProject,
      project,
      runWasm,
      setBusy,
      setDiagnostics,
      setError,
      setMobileView,
      setShowDiff,
      setShowProblems,
    ],
  );
  runAction.current = () => void run(false, "background");

  const formatSource = useCallback(async () => {
    if (
      draftConflict ||
      !editor.current ||
      !client.current ||
      loadingProject ||
      !project.current.activePath.endsWith(".mcl")
    )
      return;
    const view = editor.current;
    const currentRevision = ++revision.current;
    setBusy(true);
    setError("");
    try {
      const result = await client.current.format(view.state.doc.toString(), currentRevision);
      if (currentRevision !== revision.current) return;
      if (!result.ok) {
        if (result.error) setError(`${result.error.code}: ${result.error.message}`);
        return;
      }
      const formatted = result.result?.source;
      if (project.current.activePath !== activePath || formatted === undefined) return;
      const original = view.state.doc.toString();
      if (formatted === original) return;
      let prefix = 0;
      while (
        prefix < original.length &&
        prefix < formatted.length &&
        original[prefix] === formatted[prefix]
      )
        prefix += 1;
      let suffix = 0;
      while (
        suffix < original.length - prefix &&
        suffix < formatted.length - prefix &&
        original[original.length - suffix - 1] === formatted[formatted.length - suffix - 1]
      )
        suffix += 1;
      view.dispatch({
        changes: {
          from: prefix,
          to: original.length - suffix,
          insert: formatted.slice(prefix, formatted.length - suffix),
        },
      });
    } catch (cause) {
      if (currentRevision === revision.current)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (currentRevision === revision.current) setBusy(false);
    }
  }, [activePath, client, draftConflict, editor, loadingProject, project, setBusy, setError]);

  const cancel = useCallback(() => {
    revision.current += 1;
    client.current?.cancel();
    setBusy(false);
    setError("");
  }, [client, setBusy, setError]);

  const retryWasm = useCallback(async () => {
    const activeClient = client.current;
    if (!activeClient) return;
    setError("");
    setWasmStatus("waiting");
    try {
      await activeClient.warmUp("interactive");
      setWasmStatus("ready");
      if (startupReady.current) runAction.current();
    } catch (cause) {
      if (cause instanceof DraftConflictError) return;
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [client, setError, startupReady]);

  return {
    cancel,
    formatSource,
    notifyInitialContentChanged,
    notifyProjectReplaced,
    notifySourceChanged,
    previousYaml,
    projectContentRevision,
    renderedContentRevision,
    renderPending,
    reply,
    retryWasm,
    revision,
    run,
    runAction,
    setWasmStatus,
    staleYaml,
    wasmStatus,
  };
}
