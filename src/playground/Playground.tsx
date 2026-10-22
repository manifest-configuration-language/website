import { useCallback, useEffect, useRef, useState } from "react";
import { createPlaygroundClient } from "./apiClient";
import { MclEditor } from "./MclEditor";
import { PlaygroundResult } from "./PlaygroundResult";
import { ProjectFileInput } from "./ProjectFileInput";
import type { EditorView } from "@codemirror/view";
import type { PlaygroundDiagnostic, PlaygroundReply, ProjectFile } from "./types";

export default function Playground() {
  const editor = useRef<EditorView | undefined>(undefined);
  const client = useRef<ReturnType<typeof createPlaygroundClient> | undefined>(undefined);
  const revision = useRef(0);
  const active = useRef(false);
  const projectLoads = useRef(0);
  const [reply, setReply] = useState<PlaygroundReply>();
  const [error, setError] = useState("");
  const [editorError, setEditorError] = useState("");
  const [editorAttempt, setEditorAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [loadingProject, setLoadingProject] = useState(false);
  const [projectFiles, setProjectFiles] = useState<Record<string, ProjectFile>>({});
  const [projectSize, setProjectSize] = useState(0);

  useEffect(() => {
    client.current = createPlaygroundClient();
    return () => {
      client.current?.dispose();
      client.current = undefined;
    };
  }, []);

  const onEditorReady = useCallback((view: EditorView | undefined) => {
    editor.current = view;
  }, []);

  const onEditorError = useCallback((cause: Error) => {
    setEditorError(cause.message);
  }, []);

  const onDocumentChange = useCallback(() => {
    revision.current += 1;
    if (active.current) client.current?.cancel();
    active.current = false;
    setBusy(false);
    setReply(undefined);
    setError("");
  }, []);

  async function run() {
    if (!editor.current || !client.current || loadingProject) return;
    const currentRevision = ++revision.current;
    active.current = true;
    setBusy(true);
    setError("");
    setReply(undefined);
    try {
      const result = await client.current.run(
        editor.current.state.doc.toString(),
        currentRevision,
        projectFiles,
      );
      if (currentRevision === revision.current) setReply(result);
    } catch (cause) {
      if (currentRevision === revision.current)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (currentRevision === revision.current) {
        active.current = false;
        setBusy(false);
      }
    }
  }

  async function formatSource() {
    if (!editor.current || !client.current || loadingProject) return;
    const currentRevision = ++revision.current;
    active.current = true;
    setBusy(true);
    setError("");
    setReply(undefined);
    try {
      const result = await client.current.format(
        editor.current.state.doc.toString(),
        currentRevision,
      );
      if (currentRevision !== revision.current) return;
      if (!result.ok) {
        setReply(result);
      } else if (result.result?.source !== undefined) {
        const view = editor.current;
        if (view) {
          active.current = false;
          view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: result.result.source },
          });
        }
      }
    } catch (cause) {
      if (currentRevision === revision.current)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (currentRevision === revision.current) {
        active.current = false;
        setBusy(false);
      }
    }
  }

  function cancel() {
    revision.current += 1;
    active.current = false;
    client.current?.cancel();
    setBusy(false);
    setError("");
    setReply(undefined);
  }

  async function loadProject(files: File[]) {
    if (!client.current) throw new Error("The playground is not ready.");
    projectLoads.current += 1;
    setLoadingProject(true);
    setError("");
    try {
      return await client.current.loadProject(files);
    } finally {
      projectLoads.current -= 1;
      setLoadingProject(projectLoads.current > 0);
    }
  }

  function applyProject(project: Awaited<ReturnType<typeof loadProject>>) {
    if (editor.current)
      editor.current.dispatch({
        changes: { from: 0, to: editor.current.state.doc.length, insert: project.source },
      });
    setProjectFiles(project.files);
    setProjectSize(project.bytes);
    setError("");
  }

  function goToDiagnostic(diagnostic: PlaygroundDiagnostic) {
    const view = editor.current;
    if (!view) return;
    const line = view.state.doc.line(Math.min(Math.max(diagnostic.line, 1), view.state.doc.lines));
    const position = Math.min(line.from + Math.max(diagnostic.column - 1, 0), line.to);
    view.dispatch({ selection: { anchor: position }, scrollIntoView: true });
    view.focus();
  }

  return (
    <section className="playground" aria-label="MCLプレイグラウンド" aria-busy={loadingProject}>
      <div className="playground-toolbar">
        {busy ? (
          <button type="button" onClick={cancel}>
            中断
          </button>
        ) : (
          <>
            <button type="button" onClick={run} disabled={loadingProject || Boolean(editorError)}>
              実行
            </button>
            <button
              type="button"
              onClick={formatSource}
              disabled={loadingProject || Boolean(editorError)}
            >
              整形
            </button>
          </>
        )}
        <ProjectFileInput
          fileCount={Object.keys(projectFiles).length}
          projectSize={projectSize}
          onLoad={loadProject}
          onLoaded={applyProject}
          onError={setError}
          disabled={busy || loadingProject || Boolean(editorError)}
        />
        <a href="/playground/capabilities">対応機能</a>
      </div>
      {loadingProject && (
        <p role="status" aria-live="polite">
          読み込み中
        </p>
      )}
      <MclEditor
        key={editorAttempt}
        onReady={onEditorReady}
        onDocumentChange={onDocumentChange}
        onError={onEditorError}
      />
      {editorError && (
        <p role="alert">
          {editorError}{" "}
          <button
            onClick={() => {
              setEditorError("");
              setEditorAttempt((attempt) => attempt + 1);
            }}
          >
            再試行
          </button>
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      <PlaygroundResult reply={reply} onDiagnostic={goToDiagnostic} />
    </section>
  );
}
