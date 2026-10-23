import { get, set } from "idb-keyval";
import { Group, Panel, Separator } from "react-resizable-panels";
import { useCallback, useEffect, useRef, useState } from "react";
import type { EditorView } from "@codemirror/view";
import { createPlaygroundClient } from "./apiClient";
import { MclEditor, initialSource, type EditorSettings } from "./MclEditor";
import { ProjectTabs } from "./ProjectTabs";
import { decodeSharedProject, encodeSharedProject } from "./projectShare";
import { PlaygroundResult } from "./PlaygroundResult";
import { ProjectFileInput } from "./ProjectFileInput";
import type { PlaygroundDefinitionLocation, PlaygroundDiagnostic, PlaygroundReply, ProjectFile } from "./types";
import { writeProjectArchive } from "./projectZip";

const storageKey = "mcl-playground-project-v1";
const editorSettingsKey = "mcl-playground-editor-settings-v1";
const defaultEditorSettings: EditorSettings = { tabSize: 2, lineWrapping: false, lineNumbers: true, vim: false };
const samples = {
  configMap: initialSource,
  deployment: `let port = node:
  name: "http"
  containerPort: 8080
let deployment = node:
  apiVersion: "apps/v1"
  kind: "Deployment"
  metadata:
    name: "sample-api"
    labels:
      app: "sample-api"
  spec:
    selector:
      matchLabels:
        app: "sample-api"
    template:
      metadata:
        labels:
          app: "sample-api"
      spec:
        containers:
          - name: "api"
            image: "example.test.walnuts.dev/api:v1"
            ports:
              - port
emit deployment
`,
};

type StoredProject = { source: string; files: Record<string, ProjectFile>; activePath?: string };

function isStoredProject(value: unknown): value is StoredProject {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.source !== "string" || !candidate.files || typeof candidate.files !== "object" || Array.isArray(candidate.files) || candidate.activePath !== undefined && typeof candidate.activePath !== "string") return false;
  return Object.values(candidate.files).every((file) => {
    if (!file || typeof file !== "object") return false;
    const candidateFile = file as Record<string, unknown>;
    return candidateFile.encoding === "utf8" && typeof candidateFile.content === "string" ||
      candidateFile.encoding === "binary" && candidateFile.bytes instanceof Uint8Array;
  });
}

function isEditorSettings(value: unknown): value is EditorSettings {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (candidate.tabSize === 2 || candidate.tabSize === 4) &&
    typeof candidate.lineWrapping === "boolean" &&
    typeof candidate.lineNumbers === "boolean" &&
    typeof candidate.vim === "boolean";
}

function projectSize(files: Record<string, ProjectFile>): number {
  const encoder = new TextEncoder();
  return Object.values(files).reduce((total, file) => total + (file.encoding === "utf8" ? encoder.encode(file.content).byteLength : file.bytes.byteLength), 0);
}

export default function Playground() {
  const editor = useRef<EditorView | undefined>(undefined);
  const client = useRef<ReturnType<typeof createPlaygroundClient> | undefined>(undefined);
  const revision = useRef(0);
  const lintTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const sourceRef = useRef(initialSource);
  const projectFilesRef = useRef<Record<string, ProjectFile>>({});
  const latestYaml = useRef<string | undefined>(undefined);
  const activePathRef = useRef("main.mcl");
  const pendingNavigation = useRef<PlaygroundDiagnostic | undefined>(undefined);
  const startupReady = useRef(false);
  const applyingSample = useRef(false);
  const [reply, setReply] = useState<PlaygroundReply>();
  const [previousYaml, setPreviousYaml] = useState<string>();
  const [showDiff, setShowDiff] = useState(false);
  const [editorSettings, setEditorSettings] = useState<EditorSettings>(defaultEditorSettings);
  const [editorSettingsLoaded, setEditorSettingsLoaded] = useState(false);
  const [diagnostics, setDiagnostics] = useState<PlaygroundDiagnostic[]>([]);
  const [error, setError] = useState("");
  const [editorError, setEditorError] = useState("");
  const [editorAttempt, setEditorAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [loadingProject, setLoadingProject] = useState(false);
  const [projectFiles, setProjectFiles] = useState<Record<string, ProjectFile>>({});
  const [projectSizeBytes, setProjectSizeBytes] = useState(0);
  const [activePath, setActivePath] = useState("main.mcl");
  const [projectGeneration, setProjectGeneration] = useState(0);
  const [contentRevision, setContentRevision] = useState(0);
  const [wasmReady, setWasmReady] = useState(false);
  const [orientation, setOrientation] = useState<"horizontal" | "vertical">("horizontal");
  const [sample, setSample] = useState<keyof typeof samples | "custom">("configMap");

  const mclPaths = [
    "main.mcl",
    ...Object.entries(projectFiles)
      .filter(([path, file]) => path.endsWith(".mcl") && file.encoding === "utf8")
      .map(([path]) => path)
      .sort(),
  ];
  const projectPaths = ["main.mcl", ...Object.keys(projectFiles).sort()];
  const activeSource = activePath === "main.mcl"
    ? sourceRef.current
    : projectFiles[activePath]?.encoding === "utf8" ? projectFiles[activePath].content : "";

  const scheduleLint = useCallback((source: string, currentRevision: number) => {
    if (lintTimer.current) clearTimeout(lintTimer.current);
    lintTimer.current = setTimeout(async () => {
      const result = await client.current?.lint(source, currentRevision, projectFilesRef.current);
      if (result && currentRevision === revision.current) {
        setWasmReady(true);
        const currentDiagnostics = result.ok ? result.diagnostics ?? [] : result.error ? [result.error] : [];
        setDiagnostics(currentDiagnostics);
        setReply((previous) => previous ? { ...previous, diagnostics: currentDiagnostics } : previous);
      }
    }, 400);
  }, []);

  const applyProject = useCallback((project: StoredProject) => {
    if (!applyingSample.current) setSample("custom");
    sourceRef.current = project.source;
    projectFilesRef.current = project.files;
    const requestedPath = project.activePath;
    const nextPath = requestedPath && requestedPath.endsWith(".mcl") && project.files[requestedPath]?.encoding === "utf8"
      ? requestedPath
      : "main.mcl";
    activePathRef.current = nextPath;
    setActivePath(nextPath);
    setProjectFiles(project.files);
    setProjectSizeBytes(projectSize(project.files) + new TextEncoder().encode(project.source).byteLength);
    setProjectGeneration((value) => value + 1);
    setBusy(false);
    setError("");
    const currentRevision = ++revision.current;
    setDiagnostics([]);
    setContentRevision((value) => value + 1);
    if (startupReady.current) scheduleLint(project.source, currentRevision);
  }, [scheduleLint]);

  useEffect(() => {
    const createdClient = createPlaygroundClient();
    client.current = createdClient;

    let cancelled = false;
    void (async () => {
      let restored: StoredProject | undefined;
      try {
        const shared = await decodeSharedProject(window.location.hash);
        if (shared) restored = shared;
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      }
      if (!restored) {
        try {
          const saved: unknown = await get(storageKey);
          if (isStoredProject(saved)) restored = saved;
        } catch (cause) {
          if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
        }
      }
      if (cancelled) return;
      if (restored) applyProject(restored);
      startupReady.current = true;
      setContentRevision((value) => value + 1);
      const currentRevision = ++revision.current;
      void createdClient.warmUp().then(() => {
        if (!cancelled) setWasmReady(true);
      }).catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      });
      scheduleLint(sourceRef.current, currentRevision);
    })();

    return () => {
      cancelled = true;
      if (lintTimer.current) clearTimeout(lintTimer.current);
      createdClient.dispose();
      client.current = undefined;
    };
  }, [applyProject, scheduleLint]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 48rem)");
    const update = () => setOrientation(media.matches ? "vertical" : "horizontal");
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!startupReady.current) return;
    const timer = setTimeout(() => {
      void set(storageKey, { source: sourceRef.current, files: projectFilesRef.current, activePath: activePathRef.current });
    }, 300);
    return () => clearTimeout(timer);
  }, [contentRevision]);

  useEffect(() => {
    let cancelled = false;
    void get(editorSettingsKey).then((saved: unknown) => {
      if (!cancelled && isEditorSettings(saved)) setEditorSettings(saved);
    }).catch((cause: unknown) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
    }).finally(() => {
      if (!cancelled) setEditorSettingsLoaded(true);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!editorSettingsLoaded) return;
    void set(editorSettingsKey, editorSettings).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : String(cause));
    });
  }, [editorSettings, editorSettingsLoaded]);

  const onEditorReady = useCallback((view: EditorView | undefined) => {
    editor.current = view;
    if (view && activePathRef.current === "main.mcl") sourceRef.current = view.state.doc.toString();
    const diagnostic = pendingNavigation.current;
    if (view && diagnostic && (diagnostic.path ?? "main.mcl") === activePathRef.current) {
      pendingNavigation.current = undefined;
      goToEditorPosition(diagnostic);
    }
  }, []);

  const onEditorError = useCallback((cause: Error) => {
    setEditorError(cause.message);
  }, []);

  const onDocumentChange = useCallback((source: string, path: string) => {
    if (path === "main.mcl") {
      sourceRef.current = source;
    } else {
      const files = Object.assign(Object.create(null), projectFilesRef.current) as Record<string, ProjectFile>;
      files[path] = { encoding: "utf8", content: source };
      projectFilesRef.current = files;
      setProjectFiles(files);
      setProjectSizeBytes(projectSize(files) + new TextEncoder().encode(sourceRef.current).byteLength);
    }
    if (!applyingSample.current) setSample("custom");
    const currentRevision = ++revision.current;
    setContentRevision((value) => value + 1);
    setDiagnostics([]);
    setError("");
    setBusy(false);
    if (startupReady.current) scheduleLint(sourceRef.current, currentRevision);
  }, [scheduleLint]);

  async function run() {
    if (!editor.current || !client.current || loadingProject) return;
    const currentRevision = ++revision.current;
    setBusy(true);
    setError("");
    try {
      const result = await client.current.run(sourceRef.current, currentRevision, projectFilesRef.current);
      if (currentRevision !== revision.current) return;
      setDiagnostics(result.diagnostics ?? (result.error ? [result.error] : []));
      if (result.ok) {
        const yaml = result.result?.yaml;
        if (yaml !== undefined) {
          setPreviousYaml(latestYaml.current);
          latestYaml.current = yaml;
          setShowDiff(false);
        }
        setReply(result);
      }
      else if (result.error) setError(`${result.error.code}: ${result.error.message}`);
    } catch (cause) {
      if (currentRevision === revision.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (currentRevision === revision.current) setBusy(false);
    }
  }

  async function formatSource() {
    if (!editor.current || !client.current || loadingProject) return;
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
      if (activePathRef.current !== activePath || formatted === undefined) return;
      const original = view.state.doc.toString();
      let prefix = 0;
      while (prefix < original.length && prefix < formatted.length && original[prefix] === formatted[prefix]) prefix += 1;
      let suffix = 0;
      while (suffix < original.length - prefix && suffix < formatted.length - prefix && original[original.length - suffix - 1] === formatted[formatted.length - suffix - 1]) suffix += 1;
      view.dispatch({
        changes: {
          from: prefix,
          to: original.length - suffix,
          insert: formatted.slice(prefix, formatted.length - suffix),
        },
      });
    } catch (cause) {
      if (currentRevision === revision.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (currentRevision === revision.current) setBusy(false);
    }
  }

  function cancel() {
    revision.current += 1;
    client.current?.cancel();
    setBusy(false);
    setError("");
  }

  async function loadProject(files: File[]) {
    if (!client.current) throw new Error("Playground is not ready");
    return await client.current.loadProject(files);
  }

  async function exportProject() {
    try {
      const archive = await writeProjectArchive({ source: sourceRef.current, files: projectFilesRef.current });
      const url = URL.createObjectURL(archive);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "mcl-project.zip";
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setError("ZIPを書き出しました");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function shareProject() {
    try {
      const fragment = await encodeSharedProject({ source: sourceRef.current, files: projectFilesRef.current, activePath: activePathRef.current });
      const shareURL = new URL(window.location.href);
      shareURL.hash = fragment.slice(1);
      await navigator.clipboard.writeText(shareURL.href);
      history.replaceState(null, "", fragment);
      setError("共有URLをコピーしました");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function copyOutput() {
    const yaml = reply?.result?.yaml;
    if (!yaml) return;
    try {
      await navigator.clipboard.writeText(yaml);
      setError("YAMLをコピーしました");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  function downloadOutput() {
    const yaml = reply?.result?.yaml;
    if (!yaml) return;
    const url = URL.createObjectURL(new Blob([yaml], { type: "application/yaml;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "manifest.yaml";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function goToDiagnostic(diagnostic: PlaygroundDiagnostic) {
    const targetPath = diagnostic.path ?? "main.mcl";
    if (!mclPaths.includes(targetPath)) return;
    if (targetPath !== activePathRef.current) {
      selectFile(targetPath, diagnostic);
      return;
    }
    goToEditorPosition(diagnostic);
  }

  function navigateToDefinition(location: PlaygroundDefinitionLocation) {
    if (!mclPaths.includes(location.path)) return;
    const navigation: PlaygroundDiagnostic = {
      code: "MCL-NAVIGATION",
      message: "",
      severity: "info",
      path: location.path,
      line: location.range.start.line + 1,
      column: location.range.start.character + 1,
    };
    if (location.path !== activePathRef.current) {
      selectFile(location.path, navigation);
      return;
    }
    goToEditorPosition(navigation);
  }

  function sourceForPath(path: string) {
    if (path === "main.mcl") return sourceRef.current;
    const file = projectFilesRef.current[path];
    return file?.encoding === "utf8" ? file.content : "";
  }

  function goToEditorPosition(diagnostic: PlaygroundDiagnostic) {
    const view = editor.current;
    if (!view) return;
    const line = view.state.doc.line(Math.min(Math.max(diagnostic.line, 1), view.state.doc.lines));
    const position = Math.min(line.from + Math.max(diagnostic.column - 1, 0), line.to);
    view.dispatch({ selection: { anchor: position }, scrollIntoView: true });
    view.focus();
  }

  function selectFile(path: string, diagnostic?: PlaygroundDiagnostic) {
    if (path === activePathRef.current) return;
    pendingNavigation.current = diagnostic;
    activePathRef.current = path;
    revision.current += 1;
    setBusy(false);
    setActivePath(path);
    setContentRevision((value) => value + 1);
  }

  return (
    <section className="playground" aria-label="MCLプレイグラウンド" aria-busy={loadingProject}>
      <div className="playground-toolbar">
        {busy ? (
          <button type="button" onClick={cancel}>中断</button>
        ) : (
          <>
            <button type="button" onClick={run} disabled={loadingProject || Boolean(editorError)}>実行</button>
            <button type="button" onClick={formatSource} disabled={loadingProject || Boolean(editorError)}>整形</button>
          </>
        )}
        <label>
          サンプル
          <select value={sample} disabled={busy || loadingProject} onChange={(event) => {
            const selected = event.currentTarget.value as keyof typeof samples;
            applyingSample.current = true;
            setSample(selected);
            applyProject({ source: samples[selected], files: {} });
            applyingSample.current = false;
          }}>
            <option value="custom" disabled>カスタム</option>
            <option value="configMap">ConfigMap</option>
            <option value="deployment">Deployment</option>
          </select>
        </label>
        <button type="button" onClick={shareProject} disabled={busy || loadingProject}>共有</button>
        <ProjectFileInput
          fileCount={Object.keys(projectFiles).length + 1}
          projectSize={projectSizeBytes}
          onLoad={loadProject}
          onLoaded={applyProject}
          onError={setError}
          onLoading={setLoadingProject}
          onExport={exportProject}
          disabled={busy || loadingProject || Boolean(editorError)}
        />
        <a href="/playground/capabilities">対応機能</a>
        <label className="playground-setting">
          Tab幅
          <select value={editorSettings.tabSize} onChange={(event) => setEditorSettings((settings) => ({ ...settings, tabSize: Number(event.currentTarget.value) as 2 | 4 }))}>
            <option value={2}>2</option>
            <option value={4}>4</option>
          </select>
        </label>
        <label className="playground-setting"><input type="checkbox" checked={editorSettings.lineWrapping} onChange={(event) => setEditorSettings((settings) => ({ ...settings, lineWrapping: event.currentTarget.checked }))} />折り返し</label>
        <label className="playground-setting"><input type="checkbox" checked={editorSettings.lineNumbers} onChange={(event) => setEditorSettings((settings) => ({ ...settings, lineNumbers: event.currentTarget.checked }))} />行番号</label>
        <label className="playground-setting"><input type="checkbox" checked={editorSettings.vim} onChange={(event) => setEditorSettings((settings) => ({ ...settings, vim: event.currentTarget.checked }))} />Vim</label>
        <span role="status">{wasmReady ? "WASM準備完了" : "WASM準備中"}</span>
      </div>
      {loadingProject && <p role="status">読み込み中</p>}
      <Group className="playground-panels" orientation={orientation}>
        <Panel defaultSize={55} minSize={25}>
          <ProjectTabs paths={projectPaths} files={projectFiles} activePath={activePath} onSelect={selectFile} disabled={busy || loadingProject} />
          <MclEditor
            key={`${editorAttempt}:${projectGeneration}`}
            path={activePath}
            source={activeSource}
            settings={editorSettings}
            onReady={onEditorReady}
            onDocumentChange={onDocumentChange}
            onError={onEditorError}
            diagnostics={diagnostics}
            onRun={() => void run()}
            onFormat={() => void formatSource()}
            onComplete={(path, position) => client.current?.complete(sourceForPath(path), path, position, projectFilesRef.current) ?? Promise.resolve([])}
            onDefinition={(path, position) => client.current?.definition(sourceForPath(path), path, position, projectFilesRef.current) ?? Promise.resolve(null)}
            onHover={(path, position) => client.current?.hover(sourceForPath(path), path, position, projectFilesRef.current) ?? Promise.resolve(null)}
            onNavigate={navigateToDefinition}
          />
        </Panel>
        <Separator className="playground-resize-handle" aria-label="エディターと結果の幅を変更" />
        <Panel defaultSize={45} minSize={25}>
          <div className="playground-result-panel">
            <div className="playground-result-toolbar">
              <span>YAML</span>
              <button type="button" onClick={() => setShowDiff((value) => !value)} disabled={previousYaml === undefined || previousYaml === reply?.result?.yaml} aria-pressed={showDiff}>差分</button>
              <button type="button" onClick={() => void copyOutput()} disabled={!reply?.result?.yaml}>コピー</button>
              <button type="button" onClick={downloadOutput} disabled={!reply?.result?.yaml}>ダウンロード</button>
            </div>
            <PlaygroundResult reply={reply} previousYaml={previousYaml} showDiff={showDiff} onDiagnostic={goToDiagnostic} />
          </div>
        </Panel>
      </Group>
      {editorError && (
        <p role="alert">
          {editorError} <button onClick={() => { setEditorError(""); setEditorAttempt((attempt) => attempt + 1); }}>再試行</button>
        </p>
      )}
      {error && <p role="status">{error}</p>}
    </section>
  );
}
