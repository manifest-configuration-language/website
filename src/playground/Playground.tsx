import { Group, Panel, Separator, useGroupRef, type Layout } from "react-resizable-panels";
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type SyntheticEvent,
} from "react";
import type { EditorView } from "@codemirror/view";
import type { EditorState } from "@codemirror/state";
import { selectNextOccurrence, selectSelectionMatches } from "@codemirror/search";
import { toggleComment } from "@codemirror/commands";
import { I18nProvider } from "react-aria-components";
import type { RuntimeStatus } from "@manifest-configuration-language/browser";
import { useTranslation } from "react-i18next";
import { playgroundLocale } from "./playgroundI18n";
import { createPlaygroundClient } from "./apiClient";
import { MclEditor, initialSource, type ApplyWorkspaceEdits } from "./MclEditor";
import { ProjectTabs } from "./ProjectTabs";
import { TextProjectEditor } from "./TextProjectEditor";
import { decodeSharedProject, parseSharedProjectPayload } from "./projectShare";
import { loadShortShare } from "./projectShareApi";
import { projectSnapshotError, projectSnapshotErrorMessage } from "./projectValidation.js";
import { PlaygroundResult } from "./PlaygroundResult";
import type { SourceMapLocationCandidate } from "./PlaygroundResult";
import { WorkspaceOutputPane } from "./WorkspaceOutputPane";
import { PlaygroundSettingsDialog } from "./PlaygroundSettingsDialog";
import { PlaygroundEditorDialogs } from "./PlaygroundEditorDialogs";
import { ProjectFileInput } from "./ProjectFileInput";
import type { PlaygroundDiagnostic, PlaygroundReply, ProjectFile } from "./types";
import { writeProjectArchive } from "./projectZip";
import exampleCatalog from "./generatedExamples.json";
import { usePlaygroundProject } from "./usePlaygroundProject";
import { usePlaygroundRuntime } from "./usePlaygroundRuntime";
import { renamePreviewEntries, usePlaygroundLanguageActions } from "./usePlaygroundLanguageActions";
import { type QuickAccessItem } from "./QuickAccessList";
import { PlaygroundQuickAccessDialogs } from "./PlaygroundQuickAccessDialogs";
import { PlaygroundShareDialog } from "./PlaygroundShareDialog";
import { DraftConflictDialog } from "./DraftConflictDialog";
import { ProjectName } from "./ProjectName";
import { SourceMapCandidateDialog } from "./SourceMapCandidateDialog";
import { usePlaygroundSharing } from "./usePlaygroundSharing";
import "./symbolRenamePreview.css";
import {
  DraftConflictError,
  isStoredProject,
  usePlaygroundPersistence,
} from "./usePlaygroundPersistence";
import type { StoredProject } from "./usePlaygroundPersistence";

const layoutPreferenceKey = "mcl-playground-layout-v1";
const defaultPanelLayout: Layout = { editor: 60, output: 40 };
const runtimeMeasurementPrefix = "mcl.playground.";
const runtimeMeasurementLimit = 100;

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function recordRuntimeMeasurement(
  name: string,
  start: number,
  duration: number,
  detail: Record<string, string | number | undefined>,
) {
  performance.measure(name, {
    start: Math.max(0, start),
    duration,
    detail,
  });
  const entries = performance
    .getEntriesByType("measure")
    .filter((entry) => entry.name.startsWith(runtimeMeasurementPrefix))
    .sort((left, right) => left.startTime - right.startTime);
  for (const entry of entries.slice(0, Math.max(0, entries.length - runtimeMeasurementLimit)))
    performance.clearMeasures(entry.name);
}

type LayoutPreference = {
  orientation: "horizontal" | "vertical";
  layout: Layout;
  openPaths?: string[];
  outputView?: "yaml" | "resources" | "problems" | "diff";
};

function readLayoutPreference(): LayoutPreference | undefined {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(layoutPreferenceKey) ?? "null");
    if (!value || typeof value !== "object") return undefined;
    const preference = value as Record<string, unknown>;
    if (preference.orientation !== "horizontal" && preference.orientation !== "vertical")
      return undefined;
    if (!preference.layout || typeof preference.layout !== "object") return undefined;
    const layout = preference.layout as Record<string, unknown>;
    if (
      typeof layout.editor !== "number" ||
      typeof layout.output !== "number" ||
      !Number.isFinite(layout.editor) ||
      !Number.isFinite(layout.output) ||
      layout.editor <= 0 ||
      layout.output <= 0 ||
      Math.abs(layout.editor + layout.output - 100) > 0.01
    )
      return undefined;

    const openPaths = Array.isArray(preference.openPaths)
      ? preference.openPaths.filter((path): path is string => typeof path === "string")
      : undefined;
    const outputView =
      preference.outputView === "yaml" ||
      preference.outputView === "resources" ||
      preference.outputView === "problems" ||
      preference.outputView === "diff"
        ? preference.outputView
        : undefined;

    return {
      orientation: preference.orientation,
      layout: { editor: layout.editor, output: layout.output },
      ...(openPaths ? { openPaths } : {}),
      ...(outputView ? { outputView } : {}),
    };
  } catch {
    return undefined;
  }
}

function saveLayoutPreference(preference: Partial<LayoutPreference>) {
  try {
    const stored = JSON.parse(localStorage.getItem(layoutPreferenceKey) ?? "null");
    const current = stored && typeof stored === "object" ? stored : {};
    localStorage.setItem(layoutPreferenceKey, JSON.stringify({ ...current, ...preference }));
  } catch {
    // Layout preferences are optional when browser storage is unavailable.
  }
}

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

type ExampleSpec = {
  category: string;
  title: string;
  slug: string;
  asset: string;
  description: string;
  tags: string[];
  difficulty: string;
  preview: string;
};
type FileAction = { kind: "create" } | { kind: "rename" | "delete"; path: string };
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
const shortShareDraftSessionKey = "mcl-playground-short-share-draft-v1:";

function loadShortShareDraftID(id: string): string | undefined {
  try {
    return sessionStorage.getItem(`${shortShareDraftSessionKey}${id}`) ?? undefined;
  } catch {
    return undefined;
  }
}

function saveShortShareDraftID(shareID: string, draftID: string) {
  try {
    sessionStorage.setItem(`${shortShareDraftSessionKey}${shareID}`, draftID);
  } catch {
    // Session storage may be disabled; the immutable snapshot remains available from the API.
  }
}

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

async function loadExampleFiles(example: ExampleSpec): Promise<Record<string, string>> {
  const response = await fetch(example.asset, { cache: "force-cache" });
  if (!response.ok) throw new Error(`サンプルを読み込めません: ${example.title}`);
  const value: unknown = await response.json();
  if (!value || typeof value !== "object" || !("files" in value))
    throw new Error(`サンプルの形式が正しくありません: ${example.title}`);
  const files = (value as { files: unknown }).files;
  if (
    !files ||
    typeof files !== "object" ||
    Array.isArray(files) ||
    !Object.hasOwn(files, "main.mcl") ||
    !Object.values(files).every((content) => typeof content === "string")
  ) {
    throw new Error(`サンプルの形式が正しくありません: ${example.title}`);
  }
  return files as Record<string, string>;
}

function clearShareReferenceFromURL() {
  const url = new URL(window.location.href);
  if (!url.hash.startsWith("#project=") && !url.searchParams.has("s")) return;
  if (url.hash.startsWith("#project=")) url.hash = "";
  url.searchParams.delete("s");
  history.replaceState(null, "", url);
}

function clearLegacyShareFragment() {
  if (!window.location.hash.startsWith("#project=")) return;
  history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
}

function sharedProjectError(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  if (message === "Shared project is too large")
    return "共有プロジェクトの展開サイズが上限を超えています。送信者に内容を小さくしてもらってください。";
  return message;
}

export default function Playground() {
  const { t } = useTranslation();
  const examples = exampleCatalog as unknown as ExampleSpec[];
  const client = useRef<ReturnType<typeof createPlaygroundClient> | undefined>(undefined);
  const renameFileImports = useCallback(
    (source: string, files: Record<string, ProjectFile>, oldPath: string, newPath: string) => {
      const activeClient = client.current;
      if (!activeClient) return Promise.reject(new Error("WASMを初期化しています"));
      return activeClient.renameFileImports(source, files, oldPath, newPath);
    },
    [],
  );
  const {
    project,
    projectRef,
    replace: replaceProjectState,
    setFileContent,
    select: selectProjectFile,
    createFile: createProjectFile,
    renameFile: renameProjectFile,
    deleteFile: deleteProjectFile,
  } = usePlaygroundProject(initialSource, renameFileImports);
  const editor = useRef<EditorView | undefined>(undefined);
  const mclEditorStates = useRef(new Map<string, EditorState>());
  const textEditorStates = useRef(new Map<string, EditorState>());
  const workspaceEditApplier = useRef<ApplyWorkspaceEdits | undefined>(undefined);
  const revision = useRef(0);
  const projectContentRevision = useRef(0);
  const renderedContentRevision = useRef<number | undefined>(undefined);
  const runAction = useRef<() => void>(() => {});
  const pendingNavigation = useRef<PlaygroundDiagnostic | undefined>(undefined);
  const panelGroup = useGroupRef();
  const workspace = useRef<HTMLElement | null>(null);
  const startupReady = useRef(false);
  const runtimeMeasurementSequence = useRef(0);
  const [renderState, dispatchRender] = useReducer(renderStateReducer, initialRenderState);
  const reply = renderState.reply;
  const staleYaml = renderState.stale ? renderState.latestSuccess?.result?.yaml : undefined;
  const previousYaml = renderState.previousYaml;
  const [showDiff, setShowDiff] = useState(false);
  const [showProblems, setShowProblems] = useState(false);
  const [showResources, setShowResources] = useState(false);
  const workspacePreferenceLoaded = useRef(false);
  const [targetOutputPosition, setTargetOutputPosition] = useState<
    { line: number; character: number; requestId: number } | undefined
  >();
  const [sourcePosition, setSourcePosition] = useState<
    { path: string; line: number; character: number } | undefined
  >();
  const [sourceMapCandidates, setSourceMapCandidates] = useState<SourceMapLocationCandidate[]>([]);
  const [diagnostics, setDiagnostics] = useState<PlaygroundDiagnostic[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editorError, setEditorError] = useState("");
  const [editorAttempt, setEditorAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [loadingProject, setLoadingProject] = useState(false);
  const projectFiles = project.files;
  const projectSizeBytes = project.totalBytes;
  const activePath = project.activePath;
  const [projectGeneration, setProjectGeneration] = useState(0);
  const [wasmStatus, setWasmStatus] = useState<RuntimeStatus | "waiting">("waiting");
  const [orientation, setOrientation] = useState<"horizontal" | "vertical">("horizontal");
  const [orientationOverridden, setOrientationOverridden] = useState(false);
  const [examplesOpen, setExamplesOpen] = useState(false);
  const [explorerOpen, setExplorerOpen] = useState(false);
  const [openPaths, setOpenPaths] = useState(["main.mcl"]);
  const [quickOpen, setQuickOpen] = useState(false);
  const [recentPaths, setRecentPaths] = useState(["main.mcl"]);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [mobileView, setMobileView] = useState<"editor" | "output" | "problems">("editor");
  const [fileAction, setFileAction] = useState<FileAction>();
  const [filePathInput, setFilePathInput] = useState("");
  const [fileActionError, setFileActionError] = useState("");

  const reportPersistenceError = useCallback((cause: unknown) => {
    if (cause instanceof DraftConflictError) return;
    setError(cause instanceof Error ? cause.message : String(cause));
  }, []);
  const {
    editorSettings,
    saveStatus,
    conflictedDraftIds,
    clearDraftConflict,
    setEditorSettings,
    activeDraftId,
    activeDraftIdRef,
    drafts,
    draftsRef,
    draftsLoaded,
    setActiveDraft,
    activateDraft,
    updateDraftMetadata,
    saveDraftSnapshot,
    loadDraftIndex,
    loadActiveDraftId,
    loadDraft,
    deleteDraft,
    loadLegacyProject,
    markDraftsLoaded,
  } = usePlaygroundPersistence(project, reportPersistenceError);
  const activeDraftName =
    drafts.find((draft) => draft.id === activeDraftId)?.name ?? "プロジェクト";
  const draftConflict = conflictedDraftIds.includes(activeDraftId);
  const handleShareError = useCallback((cause: unknown) => setError(sharedProjectError(cause)), []);
  const { shareDialogOpen, sharing, openShareDialog, closeShareDialog, shareProject } =
    usePlaygroundSharing({
      activeDraftIdRef,
      projectRef,
      saveDraftSnapshot,
      onNotice: setNotice,
      onError: handleShareError,
    });

  const handleLintResult = useCallback((result: PlaygroundReply) => {
    const currentDiagnostics = result.ok
      ? (result.diagnostics ?? [])
      : result.error
        ? [result.error]
        : [];
    setDiagnostics(currentDiagnostics);
  }, []);
  const handleWasmReady = useCallback(() => setWasmStatus("ready"), []);
  const runtime = usePlaygroundRuntime({
    client,
    project: projectRef,
    revision,
    onLint: handleLintResult,
    onWasmReady: handleWasmReady,
  });
  const { isRendering, renderPending, run: runWasm, scheduleLint } = runtime;

  const editablePaths = useMemo(
    () => [
      "main.mcl",
      ...Object.entries(projectFiles)
        .filter(([, file]) => file.encoding === "utf8")
        .map(([path]) => path)
        .sort(),
    ],
    [projectFiles],
  );
  const mclPaths = useMemo(
    () => editablePaths.filter((path) => path.endsWith(".mcl")),
    [editablePaths],
  );
  const currentSourceMap =
    reply?.ok && renderedContentRevision.current === projectContentRevision.current
      ? reply.result?.sourceMap
      : undefined;
  const languageActions = usePlaygroundLanguageActions({
    editor,
    client,
    project: projectRef,
    revision,
    workspaceEditApplier,
    mclPaths,
    activePath,
    currentSourceMap,
    reply,
    languageServiceFiles,
    sourceForPath,
    selectFile,
    goToEditorPosition,
    replaceProjectState,
    finishProjectMutation,
    setMobileView,
    setTargetOutputPosition,
    setShowProblems,
    setShowDiff,
    onNotice: setNotice,
    onError: setError,
  });
  const {
    symbolRenameOpen,
    symbolRenameInput,
    symbolRenameError,
    pendingSymbolRename,
    symbolReferences,
    symbolReferencesError,
    symbolReferencesOpen,
    setSymbolRenameInput,
    closeSymbolReferences,
    navigateToDefinition,
    goToDefinitionAtCursor,
    findSymbolReferences,
    navigateToSourceMapLocation,
    navigateToYaml,
    renameSymbol,
    applySymbolRename,
    openSymbolRename,
    closeSymbolRename,
    resetSymbolRename,
  } = languageActions;
  const handleEditorSelectionChange = useCallback(
    (path: string, line: number, character: number) => setSourcePosition({ path, line, character }),
    [],
  );
  const handleSourceCandidates = useCallback(
    (candidates: SourceMapLocationCandidate[]) => {
      if (candidates.length === 1 && candidates[0]?.unambiguous) {
        setSourceMapCandidates([]);
        const [candidate] = candidates;
        navigateToSourceMapLocation(
          candidate.path,
          candidate.range.start.line,
          candidate.range.start.character,
        );
      } else if (candidates.length > 1) setSourceMapCandidates(candidates);
    },
    [navigateToSourceMapLocation],
  );
  const projectPaths = useMemo(
    () => ["main.mcl", ...Object.keys(projectFiles).sort()],
    [projectFiles],
  );
  const quickPaths = projectPaths
    .filter((path) => projectFiles[path]?.encoding === "utf8" || path === "main.mcl")
    .sort((left, right) => {
      const leftRecent = recentPaths.indexOf(left);
      const rightRecent = recentPaths.indexOf(right);
      if (leftRecent >= 0 || rightRecent >= 0)
        return (
          (leftRecent < 0 ? Infinity : leftRecent) - (rightRecent < 0 ? Infinity : rightRecent)
        );
      return left.localeCompare(right);
    });
  const symbolReferenceItems: QuickAccessItem[] = symbolReferences.map((reference, index) => {
    const { line, character } = reference.range.start;
    const sourceLine = sourceForPath(reference.path).split(/\r?\n/)[line]?.trim() ?? "";
    const location = `${reference.path}:${line + 1}:${character + 1}`;
    return {
      value: `${location} ${sourceLine} ${index}`,
      label: `${location}  ${sourceLine}`,
      keywords: [reference.path, sourceLine],
      onSelect: () => {
        navigateToDefinition(reference);
        closeSymbolReferences();
        setShowProblems(false);
        setShowDiff(false);
      },
    };
  });
  const commands = [
    { name: t("commandRun"), action: () => void run() },
    ...(activePath.endsWith(".mcl")
      ? [{ name: t("commandFormat"), action: () => void formatSource() }]
      : []),
    {
      name: t("commandToggleComment"),
      action: () => {
        const view = editor.current;
        if (!view) return;
        view.focus();
        toggleComment(view);
      },
    },
    {
      name: t("commandNextOccurrence"),
      action: () => {
        const view = editor.current;
        if (!view) return;
        view.focus();
        selectNextOccurrence(view);
      },
    },
    {
      name: t("commandSelectMatches"),
      action: () => {
        const view = editor.current;
        if (!view) return;
        view.focus();
        selectSelectionMatches(view);
      },
    },
    { name: t("commandOpenExamples"), action: () => setExamplesOpen(true) },
    {
      name: t("commandToggleExplorer"),
      action: () => setExplorerOpen((value) => !value),
    },
    ...(activePath.endsWith(".mcl")
      ? [{ name: t("commandGoToDefinition"), action: () => void goToDefinitionAtCursor() }]
      : []),
    ...(currentSourceMap && activePath.endsWith(".mcl")
      ? [{ name: t("commandGoToYaml"), action: navigateToYaml }]
      : []),
    ...(activePath.endsWith(".mcl")
      ? [
          {
            name: t("commandFindReferences"),
            action: openSymbolReferences,
          },
          {
            name: t("commandRenameSymbol"),
            action: openSymbolRename,
          },
        ]
      : []),
    {
      name: t("commandShare"),
      action: openShareDialog,
    },
    {
      name: t("commandOpenFile"),
      action: () => {
        setQuickOpen(true);
      },
    },
    {
      name: t("commandCreateFile"),
      action: () => {
        setFileActionError("");
        setFilePathInput("");
        setFileAction({ kind: "create" });
      },
    },
    { name: t("commandNewProject"), action: () => createDraft() },
    { name: t("commandShowOutput"), action: () => setMobileView("output") },
    {
      name: t("commandShowProblems"),
      action: () => {
        setMobileView("problems");
        setShowProblems(true);
        setShowDiff(false);
      },
    },
  ];
  const commandShortcuts: Record<string, string> = {
    [t("commandRun")]: "Ctrl/⌘ Enter",
    [t("commandFormat")]: "Shift+Alt+F",
    [t("commandToggleComment")]: "Ctrl/⌘ /",
    [t("commandNextOccurrence")]: "Ctrl/⌘ D",
    [t("commandSelectMatches")]: "Ctrl/⌘ ⇧ L",
    [t("commandGoToDefinition")]: "F12",
    [t("commandFindReferences")]: "Shift+F12",
    [t("commandRenameSymbol")]: "F2",
    [t("commandOpenFile")]: "Ctrl/⌘ P",
    ファイル一覧を切り替え: "Ctrl/⌘ ⇧ E",
    問題を表示: "Ctrl/⌘ ⇧ M",
  };
  const commandKeywords: Record<string, string[]> = {
    実行: ["run", "render"],
    整形: ["format", "document"],
    コメントを切り替え: ["toggle comment", "line comment", "ctrl slash"],
    次の一致を選択: ["select next occurrence", "multi cursor", "ctrl d"],
    すべての一致を選択: ["select all occurrences", "multi cursor", "ctrl shift l"],
    サンプルを開く: ["examples"],
    定義へ移動: ["definition", "f12"],
    YAMLの対応箇所へ移動: ["source map", "yaml"],
    参照箇所を検索: ["references", "shift f12"],
    シンボル名を変更: ["rename", "f2"],
    共有: ["share"],
    ファイルを開く: ["quick open", "open file", "ctrl p"],
    ファイル一覧を切り替え: ["explorer", "files", "ctrl shift e"],
    ファイルを作成: ["new file", "create file"],
    新しいプロジェクト: ["new project"],
    出力を表示: ["output"],
    問題を表示: ["problems", "diagnostics", "ctrl shift m"],
  };
  const commandItems: QuickAccessItem[] = commands.map((command) => ({
    value: command.name,
    label: command.name,
    shortcut: commandShortcuts[command.name],
    keywords: commandKeywords[command.name],
    onSelect: () => {
      setCommandPaletteOpen(false);
      command.action();
    },
  }));
  const quickOpenItems: QuickAccessItem[] = quickPaths.map((path) => ({
    value: path,
    label: path,
    onSelect: () => {
      setQuickOpen(false);
      selectFile(path);
    },
  }));
  const activeSource =
    activePath === "main.mcl"
      ? project.source
      : projectFiles[activePath]?.encoding === "utf8"
        ? projectFiles[activePath].content
        : "";

  async function finishProjectMutation() {
    const currentRevision = ++revision.current;
    projectContentRevision.current += 1;
    setDiagnostics([]);
    dispatchRender({ type: "source-changed" });
    setShowDiff(false);
    setBusy(false);
    if (startupReady.current) scheduleLint(projectRef.current.source, currentRevision);

    clearShareReferenceFromURL();
  }

  function languageServiceFiles(): Record<string, ProjectFile> {
    const files = Object.assign(Object.create(null), projectRef.current.files) as Record<
      string,
      ProjectFile
    >;
    files["main.mcl"] = { encoding: "utf8", content: projectRef.current.source };
    return files;
  }

  const applyWorkspacePreference = useCallback(
    (files: Record<string, ProjectFile>, activePath: string, fresh: boolean) => {
      const preference = fresh ? undefined : readLayoutPreference();
      const availablePaths = new Set(["main.mcl", ...Object.keys(files)]);
      const openPaths = preference?.openPaths?.filter(
        (path) =>
          availablePaths.has(path) && (path === "main.mcl" || files[path]?.encoding === "utf8"),
      );
      setOpenPaths(openPaths?.length ? [...new Set([activePath, ...openPaths])] : [activePath]);
      setShowProblems(!fresh && preference?.outputView === "problems");
      setShowResources(!fresh && preference?.outputView === "resources");
      setShowDiff(false);
      workspacePreferenceLoaded.current = true;
    },
    [],
  );

  const applyProject = useCallback(
    (
      project: StoredProject,
      options: { newDraft?: boolean; name?: string; skipCurrentSnapshot?: boolean } = {},
    ) => {
      const requestedPath = project.activePath;
      const nextPath =
        requestedPath &&
        (requestedPath === "main.mcl" || project.files[requestedPath]?.encoding === "utf8")
          ? requestedPath
          : "main.mcl";
      const validationError = projectSnapshotError({
        source: project.source,
        files: project.files,
        activePath: nextPath,
      });
      if (validationError) {
        setError(projectSnapshotErrorMessage(validationError));
        return false;
      }
      if (options.newDraft !== false && !options.skipCurrentSnapshot) {
        void saveDraftSnapshot(activeDraftIdRef.current, projectRef.current).catch(
          (cause: unknown) => {
            if (cause instanceof DraftConflictError) return;
            setError(cause instanceof Error ? cause.message : String(cause));
          },
        );
      }
      const replacement = replaceProjectState(project.source, project.files, nextPath);
      if (!replacement.ok) {
        setError(replacement.error);
        return false;
      }
      mclEditorStates.current.clear();
      textEditorStates.current.clear();
      if (options.newDraft !== false) {
        clearShareReferenceFromURL();
        activateDraft(crypto.randomUUID(), options.name ?? "インポート");
      }
      dispatchRender({ type: "project-replaced" });
      setShowDiff(false);
      projectContentRevision.current += 1;
      applyWorkspacePreference(project.files, nextPath, options.newDraft !== false);
      void saveDraftSnapshot(activeDraftIdRef.current, projectRef.current).catch(
        (cause: unknown) => {
          if (cause instanceof DraftConflictError) return;
          setError(cause instanceof Error ? cause.message : String(cause));
        },
      );
      setProjectGeneration((value) => value + 1);
      setBusy(false);
      setError("");
      const currentRevision = ++revision.current;
      setDiagnostics([]);
      if (startupReady.current) scheduleLint(project.source, currentRevision);
      return true;
    },
    [
      activateDraft,
      applyWorkspacePreference,
      projectRef,
      replaceProjectState,
      saveDraftSnapshot,
      scheduleLint,
    ],
  );

  useEffect(() => {
    if (!workspacePreferenceLoaded.current) return;
    const outputView = showDiff
      ? "diff"
      : showProblems
        ? "problems"
        : showResources
          ? "resources"
          : "yaml";
    saveLayoutPreference({ openPaths, outputView });
  }, [openPaths, showDiff, showProblems, showResources]);

  useEffect(() => {
    const preference = readLayoutPreference();
    if (!preference) return;
    setOrientationOverridden(true);
    setOrientation(preference.orientation);
    panelGroup.current?.setLayout(preference.layout);
  }, []);

  useEffect(() => {
    const element = workspace.current;
    if (!element || orientationOverridden) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = entry?.contentRect.width ?? element.clientWidth;
      setOrientation(width >= 1100 ? "horizontal" : "vertical");
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [orientationOverridden]);

  useEffect(() => {
    let cancelled = false;
    const createdClient = createPlaygroundClient(
      (event) => {
        if (cancelled) return;
        setWasmStatus(event.status);
        if (event.initializationDurationMs === undefined) return;
        const name = `${runtimeMeasurementPrefix}worker.initialization.${event.status}.${++runtimeMeasurementSequence.current}`;
        const end = performance.now();
        recordRuntimeMeasurement(
          name,
          end - event.initializationDurationMs,
          event.initializationDurationMs,
          { status: event.status, workerGeneration: event.workerGeneration },
        );
      },
      (event) => {
        if (cancelled) return;
        const name = `${runtimeMeasurementPrefix}${event.operation}.${event.outcome}.${++runtimeMeasurementSequence.current}`;
        const end = performance.now();
        recordRuntimeMeasurement(name, end - event.durationMs, event.durationMs, {
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
    let startupSettled = false;
    let runtimeReady = false;
    const editorView = editor.current;
    if (editorView) editorView.contentDOM.contentEditable = "false";
    const runInitialProject = () => {
      if (!cancelled && startupSettled && runtimeReady) runAction.current();
    };

    void createdClient
      .warmUp("background")
      .then(() => {
        if (cancelled) return;
        runtimeReady = true;
        setWasmStatus("ready");
        runInitialProject();
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      });

    const startupController = new AbortController();
    void (async () => {
      let restored: StoredProject | undefined;
      let activeId = "";
      try {
        await loadDraftIndex();

        const savedActiveId = await loadActiveDraftId();
        if (savedActiveId) {
          const saved: unknown = await loadDraft(savedActiveId);
          if (isStoredProject(saved)) {
            restored = saved;
            activeId = savedActiveId;
          }
        }
        if (!restored) {
          const legacy: unknown = await loadLegacyProject();
          if (isStoredProject(legacy)) {
            restored = legacy;
            activeId = crypto.randomUUID();
            await saveDraftSnapshot(activeId, legacy);
            activateDraft(activeId, "復元したプロジェクト");
          }
        }
        if (!activeId) {
          activeId = crypto.randomUUID();
        } else {
          await setActiveDraft(activeId);
          if (!draftsRef.current.some((draft) => draft.id === activeId))
            updateDraftMetadata(activeId, "プロジェクト");
        }
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      }
      if (!activeId) {
        activeId = crypto.randomUUID();
        activateDraft(activeId, "プロジェクト");
      }

      const shortShareId = new URL(window.location.href).searchParams.get("s");
      const hasLegacyFragment = window.location.hash.startsWith("#project=");
      try {
        if (shortShareId) {
          const sessionDraftId = loadShortShareDraftID(shortShareId);
          const sessionDraft: unknown = sessionDraftId
            ? await loadDraft(sessionDraftId)
            : undefined;
          if (cancelled) return;
          if (sessionDraftId && isStoredProject(sessionDraft)) {
            restored = sessionDraft;
            activeId = sessionDraftId;
            await setActiveDraft(activeId);
            if (!draftsRef.current.some((draft) => draft.id === activeId))
              updateDraftMetadata(activeId, "共有プロジェクト");
          } else {
            const shared = parseSharedProjectPayload(
              await loadShortShare(
                shortShareId,
                AbortSignal.any([startupController.signal, AbortSignal.timeout(15_000)]),
              ),
            );
            if (cancelled) return;
            restored = shared;
            activeId = crypto.randomUUID();
            activateDraft(activeId, "共有プロジェクト");
            saveShortShareDraftID(shortShareId, activeId);
          }
        } else {
          const shared = await decodeSharedProject(window.location.hash);
          if (shared) {
            restored = shared;
            activeId = crypto.randomUUID();
            activateDraft(activeId, "共有プロジェクト");
          }
        }
      } catch (cause) {
        if (!cancelled) setError(sharedProjectError(cause));
      }

      if (!shortShareId && !window.location.hash.startsWith("#project=")) {
        const url = new URL(window.location.href);
        const exampleSlug = url.searchParams.get("example");
        const example = examples.find((entry) => entry.slug === exampleSlug);
        if (example) {
          try {
            const files = await loadExampleFiles(example);
            const { ["main.mcl"]: source, ...otherFiles } = files;
            restored = {
              source,
              files: Object.fromEntries(
                Object.entries(otherFiles).map(([path, content]) => [
                  path,
                  { encoding: "utf8", content },
                ]),
              ),
            };
            activeId = crypto.randomUUID();
            activateDraft(activeId, example.title);
            url.searchParams.delete("example");
            history.replaceState(null, "", url);
          } catch (cause) {
            if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
          }
        }
      }
      if (cancelled) return;
      if (!draftsRef.current.some((draft) => draft.id === activeId))
        activateDraft(activeId, "プロジェクト");
      if (restored) {
        const applied = applyProject(restored, { newDraft: false });
        if (applied && hasLegacyFragment) clearLegacyShareFragment();
      } else {
        applyWorkspacePreference(projectRef.current.files, projectRef.current.activePath, false);
      }
      startupReady.current = true;
      startupSettled = true;
      if (editor.current) editor.current.contentDOM.contentEditable = "true";
      markDraftsLoaded();
      runInitialProject();
    })();

    return () => {
      cancelled = true;
      startupController.abort();
      createdClient.dispose();
      client.current = undefined;
    };
  }, [
    activateDraft,
    applyWorkspacePreference,
    applyProject,
    examples,
    loadActiveDraftId,
    loadDraft,
    loadDraftIndex,
    loadLegacyProject,
    markDraftsLoaded,
    projectRef,
    saveDraftSnapshot,
    setActiveDraft,
    updateDraftMetadata,
  ]);

  useEffect(() => {
    const root = document.querySelector<HTMLElement>(".playground-app");
    if (!root) return;
    if (editorSettings.theme === "system") root.removeAttribute("data-playground-theme");
    else root.dataset.playgroundTheme = editorSettings.theme;
    return () => root.removeAttribute("data-playground-theme");
  }, [editorSettings.theme]);

  useEffect(() => {
    if (!activePath.endsWith(".mcl")) setSourcePosition(undefined);
    setSourceMapCandidates([]);
  }, [activePath]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)
        return;
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "p") {
        event.preventDefault();
        setCommandPaletteOpen(true);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "p") {
        event.preventDefault();
        setQuickOpen(true);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "e") {
        event.preventDefault();
        setExplorerOpen((value) => !value);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "m") {
        event.preventDefault();
        setMobileView("problems");
        setShowProblems(true);
        setShowDiff(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const onEditorReady = useCallback(
    (view: EditorView | undefined) => {
      editor.current = view;
      if (view && !startupReady.current) view.contentDOM.contentEditable = "false";
      if (
        view &&
        projectRef.current.activePath === "main.mcl" &&
        projectRef.current.source !== view.state.doc.toString()
      ) {
        const result = setFileContent("main.mcl", view.state.doc.toString());
        if (!result.ok) {
          setError(result.error);
          view.dispatch({
            changes: {
              from: 0,
              to: view.state.doc.length,
              insert: projectRef.current.source,
            },
          });
        } else {
          projectContentRevision.current += 1;
          revision.current += 1;
        }
      }
      const diagnostic = pendingNavigation.current;
      if (view && diagnostic && (diagnostic.path ?? "main.mcl") === projectRef.current.activePath) {
        pendingNavigation.current = undefined;
        goToEditorPosition(diagnostic);
      }
    },
    [projectRef, setFileContent],
  );

  const onEditorError = useCallback((cause: Error) => {
    setEditorError(cause.message);
  }, []);

  const onDocumentChange = useCallback(
    (source: string, path: string) => {
      const result = setFileContent(path, source);
      if (!result.ok) {
        setError(result.error);
        return false;
      }
      projectContentRevision.current += 1;
      clearShareReferenceFromURL();
      setRecentPaths((previous) => [path, ...previous.filter((entry) => entry !== path)]);
      const currentRevision = ++revision.current;
      setDiagnostics([]);
      dispatchRender({ type: "source-changed" });
      setShowDiff(false);
      setError("");
      setBusy(false);
      if (startupReady.current) scheduleLint(projectRef.current.source, currentRevision);
      return true;
    },
    [activeDraftIdRef, projectRef, scheduleLint, setFileContent],
  );

  async function run(focusOutput = true, priority: "interactive" | "background" = "interactive") {
    if (!editor.current || !client.current || loadingProject || isRendering()) return;
    const currentRevision = ++revision.current;
    const request = runWasm(projectRef.current.source, currentRevision, priority);
    if (!request) return;
    setBusy(true);
    setError("");
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
      } else {
        setMobileView("problems");
        setShowProblems(true);
        dispatchRender({ type: "failed", reply: { ...result, diagnostics: undefined } });
        if (result.error) setError(`${result.error.code}: ${result.error.message}`);
      }
    } catch (cause) {
      if (currentRevision === revision.current)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (currentRevision === revision.current) setBusy(false);
    }
  }

  runAction.current = () => void run(false, "background");

  async function formatSource() {
    if (
      draftConflict ||
      !editor.current ||
      !client.current ||
      loadingProject ||
      !projectRef.current.activePath.endsWith(".mcl")
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
      if (projectRef.current.activePath !== activePath || formatted === undefined) return;
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
  }

  function cancel() {
    revision.current += 1;
    client.current?.cancel();
    setBusy(false);
    setError("");
  }

  async function retryWasm() {
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
  }

  async function loadProject(files: File[]) {
    if (!client.current) throw new Error("Playground is not ready");
    return await client.current.loadProject(files);
  }

  async function selectSample(selected: string) {
    const builtin = samples[selected as keyof typeof samples];
    if (builtin !== undefined) {
      applyProject(
        { source: builtin, files: {} },
        { name: selected === "configMap" ? "ConfigMap" : "Deployment" },
      );
      setExamplesOpen(false);
      return;
    }
    const example = examples.find((entry) => entry.slug === selected);
    if (!example) return;

    setLoadingProject(true);
    try {
      const files = await loadExampleFiles(example);
      const { ["main.mcl"]: source, ...otherFiles } = files;
      applyProject(
        {
          source,
          files: Object.fromEntries(
            Object.entries(otherFiles).map(([path, content]) => [
              path,
              { encoding: "utf8", content },
            ]),
          ),
        },
        { name: example.title },
      );
    } catch (cause) {
      if (cause instanceof DraftConflictError) return;
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoadingProject(false);
      setExamplesOpen(false);
    }
  }

  async function openDraft(id: string) {
    if (id === activeDraftIdRef.current) return;
    try {
      await saveDraftSnapshot(activeDraftIdRef.current, projectRef.current);
      const saved: unknown = await loadDraft(id);
      if (!isStoredProject(saved)) throw new Error("プロジェクトを読み込めません");
      clearDraftConflict(id);
      await setActiveDraft(id);
      clearShareReferenceFromURL();
      applyProject(saved, { newDraft: false });
    } catch (cause) {
      if (cause instanceof DraftConflictError) return;
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function reloadConflictedDraft() {
    try {
      const saved: unknown = await loadDraft(activeDraftId);
      if (!isStoredProject(saved)) throw new Error("プロジェクトを読み込めません");
      applyProject(saved, { newDraft: false });
      clearDraftConflict(activeDraftId);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  function createDraft() {
    applyProject({ source: initialSource, files: {} }, { name: "プロジェクト" });
  }

  function duplicateDraft() {
    applyProject(projectRef.current, { name: `${activeDraftName}のコピー` });
  }

  async function deleteCurrentDraft() {
    if (!activeDraftId || !window.confirm(`「${activeDraftName}」を削除しますか？`)) return;
    try {
      await saveDraftSnapshot(activeDraftId, projectRef.current);
      await deleteDraft(activeDraftId);
      clearShareReferenceFromURL();
      const [nextDraft] = draftsRef.current;
      if (nextDraft) {
        const saved: unknown = await loadDraft(nextDraft.id);
        if (!isStoredProject(saved)) throw new Error("プロジェクトを読み込めません");
        clearDraftConflict(nextDraft.id);
        await setActiveDraft(nextDraft.id);
        applyProject(saved, { newDraft: false });
      } else {
        const nextId = crypto.randomUUID();
        activateDraft(nextId, "プロジェクト");
        applyProject({ source: initialSource, files: {} }, { newDraft: false });
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function exportProject() {
    try {
      const archive = await writeProjectArchive({
        source: projectRef.current.source,
        files: projectRef.current.files,
      });
      downloadBlob(archive, "mcl-project.zip");
      setNotice("ZIPを書き出しました");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function copyOutput() {
    const yaml = staleYaml ?? reply?.result?.yaml;
    if (yaml === undefined) return;
    try {
      await navigator.clipboard.writeText(yaml);
      setNotice("YAMLをコピーしました");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  function openSymbolReferences() {
    setShowProblems(false);
    setShowDiff(false);
    void findSymbolReferences();
  }

  function downloadOutput() {
    const yaml = staleYaml ?? reply?.result?.yaml;
    if (yaml === undefined) return;
    downloadBlob(new Blob([yaml], { type: "application/yaml;charset=utf-8" }), "manifest.yaml");
  }

  function goToDiagnostic(diagnostic: PlaygroundDiagnostic) {
    setMobileView("editor");
    const targetPath = diagnostic.path ?? "main.mcl";
    if (!editablePaths.includes(targetPath)) return;
    if (targetPath !== projectRef.current.activePath) {
      selectFile(targetPath, diagnostic);
      return;
    }
    goToEditorPosition(diagnostic);
  }

  function sourceForPath(path: string) {
    if (path === "main.mcl") return projectRef.current.source;
    const file = projectRef.current.files[path];
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
    setOpenPaths((previous) => (previous.includes(path) ? previous : [...previous, path]));
    if (path === projectRef.current.activePath) return;
    pendingNavigation.current = diagnostic;
    selectProjectFile(path);
    setRecentPaths((previous) => [path, ...previous.filter((entry) => entry !== path)]);
  }

  function requestCreateFile() {
    setFilePathInput("");
    setFileActionError("");
    setFileAction({ kind: "create" });
  }

  function requestRenameFile(path: string) {
    setFilePathInput(path);
    setFileActionError("");
    setFileAction({ kind: "rename", path });
  }

  function requestDeleteFile(path: string) {
    setFileActionError("");
    setFileAction({ kind: "delete", path });
  }

  async function submitFileAction(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!fileAction || fileAction.kind === "delete") return;
    const path = filePathInput.trim();
    const result = await (fileAction.kind === "create"
      ? createProjectFile(path)
      : renameProjectFile(fileAction.path, path));
    if (!result.ok) {
      setFileActionError(result.error);
      return;
    }
    void finishProjectMutation();
    setOpenPaths((previous) => {
      const next =
        fileAction.kind === "create"
          ? previous
          : previous.map((entry) => (entry === fileAction.path ? path : entry));
      return next.includes(path) ? next : [...next, path];
    });
    setRecentPaths((previous) =>
      fileAction.kind === "create"
        ? [path, ...previous.filter((entry) => entry !== path)]
        : previous.map((entry) => (entry === fileAction.path ? path : entry)),
    );
    setError("");
    setFileActionError("");
    setFileAction(undefined);
  }

  function confirmDeleteFile() {
    if (!fileAction || fileAction.kind !== "delete") return;
    const { path } = fileAction;
    const result = deleteProjectFile(path);
    if (!result.ok) {
      setFileActionError(result.error);
      return;
    }
    setOpenPaths((previous) => {
      const remaining = previous.filter((entry) => entry !== path);
      return remaining.length ? remaining : ["main.mcl"];
    });
    void finishProjectMutation();
    setRecentPaths((previous) => previous.filter((entry) => entry !== path));
    setError("");
    setFileActionError("");
    setFileAction(undefined);
  }

  return (
    <I18nProvider locale={playgroundLocale}>
      <section
        ref={workspace}
        className="playground"
        aria-label={t("workspaceLabel")}
        aria-busy={loadingProject}
      >
        <header className="playground-header">
          <div className="playground-brand">
            <a href="/" aria-label={t("docsHome")}>
              MCL
            </a>
            <span aria-hidden="true" className="playground-brand-separator">
              /
            </span>
            <span>Playground</span>
            <span aria-hidden="true" className="playground-brand-separator">
              /
            </span>
            <ProjectName
              name={activeDraftName}
              disabled={!draftsLoaded || !activeDraftId || draftConflict}
              onSave={(name) => updateDraftMetadata(activeDraftId, name)}
            />
          </div>
          <div className="playground-toolbar">
            <div className="playground-primary-actions" role="group" aria-label={t("editActions")}>
              {busy || renderPending ? (
                <button type="button" onClick={cancel}>
                  {t("stop")}
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="playground-run-button"
                    onClick={() => void run()}
                    disabled={!draftsLoaded || loadingProject || Boolean(editorError)}
                    aria-keyshortcuts="Control+Enter Meta+Enter"
                  >
                    {t("run")}
                    <kbd>Ctrl/⌘ Enter</kbd>
                  </button>
                  <button
                    type="button"
                    onClick={formatSource}
                    aria-keyshortcuts="Shift+Alt+F"
                    disabled={
                      !draftsLoaded ||
                      loadingProject ||
                      draftConflict ||
                      Boolean(editorError) ||
                      !activePath.endsWith(".mcl")
                    }
                  >
                    {t("formatSource")}
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={openShareDialog}
                disabled={!draftsLoaded || busy || loadingProject || draftConflict}
              >
                {t("share")}
              </button>
              <button
                type="button"
                onClick={() => setExamplesOpen(true)}
                disabled={!draftsLoaded || busy || loadingProject}
                aria-haspopup="dialog"
              >
                {t("openExamples")}
              </button>
            </div>
            <div className="playground-secondary-actions">
              <button
                className="playground-command-button"
                type="button"
                onClick={() => setCommandPaletteOpen(true)}
                aria-keyshortcuts="Control+Shift+P Meta+Shift+P"
              >
                {t("commandSearch")}
                <kbd>Ctrl/⌘ ⇧ P</kbd>
              </button>
              <details className="playground-more">
                <summary>{t("projectMenu")}</summary>
                <div className="playground-more-menu">
                  <label className="playground-project-picker">
                    <span>{t("openProject")}</span>
                    <select
                      aria-label={t("openProject")}
                      value={activeDraftId}
                      disabled={!draftsLoaded || busy || loadingProject}
                      onChange={(event) => void openDraft(event.currentTarget.value)}
                    >
                      {drafts.map((draft) => (
                        <option key={draft.id} value={draft.id}>
                          {draft.name === "作業" ? t("unnamedProject") : draft.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="playground-project-actions">
                    <button
                      type="button"
                      onClick={createDraft}
                      disabled={!draftsLoaded || busy || loadingProject}
                    >
                      {t("commandNewProject")}
                    </button>
                    <button
                      type="button"
                      onClick={duplicateDraft}
                      disabled={!draftsLoaded || busy || loadingProject}
                    >
                      {t("duplicateProject")}
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteCurrentDraft()}
                      disabled={!draftsLoaded || busy || loadingProject}
                    >
                      {t("deleteProject")}
                    </button>
                  </div>
                  <ProjectFileInput
                    fileCount={Object.keys(projectFiles).length + 1}
                    projectSize={projectSizeBytes}
                    onLoad={loadProject}
                    onLoaded={applyProject}
                    onError={setError}
                    onLoading={setLoadingProject}
                    onExport={exportProject}
                    disabled={!draftsLoaded || busy || loadingProject || Boolean(editorError)}
                  />
                  <a href="/playground/capabilities/">{t("projectCapabilities")}</a>
                </div>
              </details>
              <PlaygroundSettingsDialog
                settings={editorSettings}
                onChange={(settings) => setEditorSettings(settings)}
              />
            </div>
          </div>
        </header>
        <PlaygroundQuickAccessDialogs
          examplesOpen={examplesOpen}
          onCloseExamples={() => setExamplesOpen(false)}
          exampleItems={[
            {
              value: "configMap",
              label: "ConfigMap",
              group: t("examplesGroupBasics"),
              keywords: [t("examplesGroupBasics"), "variables", "manifest"],
              onSelect: () => void selectSample("configMap"),
            },
            {
              value: "deployment",
              label: "Deployment",
              group: t("examplesGroupBasics"),
              keywords: [t("examplesGroupBasics"), "kubernetes", "manifest"],
              onSelect: () => void selectSample("deployment"),
            },
            ...examples.map((entry) => ({
              value: entry.slug,
              label: entry.title,
              group: entry.category,
              keywords: [entry.category, entry.slug, ...entry.tags],
              description: entry.description,
              tags: entry.tags,
              difficulty: entry.difficulty,
              preview: entry.preview,
              onSelect: () => void selectSample(entry.slug),
            })),
          ]}
          quickOpen={quickOpen}
          onCloseQuickOpen={() => setQuickOpen(false)}
          quickOpenItems={quickOpenItems}
          commandPaletteOpen={commandPaletteOpen}
          onCloseCommandPalette={() => setCommandPaletteOpen(false)}
          commandItems={commandItems}
        />
        <PlaygroundShareDialog
          open={shareDialogOpen}
          sharing={sharing}
          onClose={closeShareDialog}
          onShare={() => {
            void shareProject().then((shared) => {
              if (shared) closeShareDialog();
            });
          }}
        />
        <DraftConflictDialog
          open={draftConflict}
          onFork={() =>
            applyProject(projectRef.current, {
              name: `${activeDraftName}のコピー`,
              skipCurrentSnapshot: true,
            })
          }
          onReload={() => void reloadConflictedDraft()}
        />
        {sourceMapCandidates.length > 1 && (
          <SourceMapCandidateDialog
            candidates={sourceMapCandidates}
            onClose={() => setSourceMapCandidates([])}
            onSelect={(candidate) => {
              setSourceMapCandidates([]);
              navigateToSourceMapLocation(
                candidate.path,
                candidate.range.start.line,
                candidate.range.start.character,
              );
            }}
          />
        )}
        {loadingProject && <p role="status">{t("loadingProject")}</p>}
        <nav className="playground-mobile-views" aria-label={t("viewMode")}>
          <button
            type="button"
            aria-pressed={mobileView === "editor"}
            onClick={() => setMobileView("editor")}
          >
            {t("editor")}
          </button>
          <button
            type="button"
            aria-pressed={mobileView === "output"}
            onClick={() => {
              setMobileView("output");
              setShowProblems(false);
            }}
          >
            {t("output")}
          </button>
          <button
            type="button"
            aria-pressed={mobileView === "problems"}
            onClick={() => {
              setMobileView("problems");
              setShowProblems(true);
              setShowDiff(false);
            }}
          >
            {t("problemsCount", { count: diagnostics.length })}
          </button>
        </nav>
        <Group
          className="playground-panels"
          groupRef={panelGroup}
          defaultLayout={defaultPanelLayout}
          onLayoutChanged={(layout, meta) => {
            if (meta.isUserInteraction) saveLayoutPreference({ orientation, layout });
          }}
          orientation={orientation}
          data-mobile-view={mobileView}
        >
          <Panel id="editor" className="playground-editor-panel" defaultSize="60" minSize="25">
            <div className="playground-editor-filebar">
              <button
                type="button"
                className="playground-explorer-toggle"
                aria-label={explorerOpen ? t("closeExplorer") : t("openExplorer")}
                aria-pressed={explorerOpen}
                onClick={() => setExplorerOpen((value) => !value)}
                title={explorerOpen ? t("closeExplorer") : t("openExplorer")}
              >
                ▤
              </button>
              <div className="playground-file-tabs" role="group" aria-label={t("openFiles")}>
                {openPaths.map((path) => (
                  <div className="playground-file-tab" key={path}>
                    <button
                      type="button"
                      aria-pressed={path === activePath}
                      title={path}
                      onClick={() => selectFile(path)}
                    >
                      {path.split("/").at(-1)}
                    </button>
                    {path !== "main.mcl" && (
                      <button
                        type="button"
                        className="playground-file-tab-close"
                        aria-label={t("closeFile", { path })}
                        title={t("close")}
                        onClick={() => {
                          const index = openPaths.indexOf(path);
                          const remaining = openPaths.filter((entry) => entry !== path);
                          if (path === activePath)
                            selectProjectFile(
                              remaining[Math.min(index, remaining.length - 1)] ?? "main.mcl",
                            );
                          setOpenPaths(remaining.length ? remaining : ["main.mcl"]);
                        }}
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <button
                type="button"
                className="playground-new-file"
                onClick={requestCreateFile}
                disabled={!draftsLoaded || busy || loadingProject || draftConflict}
                title={t("createFile")}
                aria-label={t("createFile")}
              >
                +
              </button>
            </div>
            <div className={`playground-editor-workspace${explorerOpen ? " has-explorer" : ""}`}>
              {explorerOpen && (
                <ProjectTabs
                  paths={projectPaths}
                  files={projectFiles}
                  activePath={activePath}
                  onSelect={selectFile}
                  onCreate={requestCreateFile}
                  onRename={requestRenameFile}
                  onDelete={requestDeleteFile}
                  disabled={!draftsLoaded || busy || loadingProject || draftConflict}
                />
              )}
              {activePath.endsWith(".mcl") ? (
                <MclEditor
                  key={`${editorAttempt}:${projectGeneration}`}
                  path={activePath}
                  paths={projectPaths}
                  source={activeSource}
                  settings={editorSettings}
                  readOnly={draftConflict}
                  editorStates={mclEditorStates.current}
                  onReady={onEditorReady}
                  onWorkspaceEditApplierReady={(applier) => {
                    workspaceEditApplier.current = applier;
                  }}
                  onDocumentChange={onDocumentChange}
                  onError={onEditorError}
                  diagnostics={diagnostics}
                  onRun={() => void run()}
                  onFormat={() => void formatSource()}
                  onComplete={(path, position) =>
                    client.current
                      ? client.current.complete(
                          sourceForPath(path),
                          path,
                          position,
                          languageServiceFiles(),
                        )
                      : Promise.resolve([])
                  }
                  onDefinition={(path, position) =>
                    client.current
                      ? client.current.definition(
                          sourceForPath(path),
                          path,
                          position,
                          languageServiceFiles(),
                        )
                      : Promise.resolve(null)
                  }
                  onHover={(path, position) =>
                    client.current
                      ? client.current.hover(
                          sourceForPath(path),
                          path,
                          position,
                          languageServiceFiles(),
                        )
                      : Promise.resolve(null)
                  }
                  onNavigate={navigateToDefinition}
                  onSelectionChange={handleEditorSelectionChange}
                  onNavigateToYaml={navigateToYaml}
                  onShowProblems={() => {
                    setMobileView("problems");
                    setShowProblems(true);
                    setShowDiff(false);
                  }}
                  onFindReferences={openSymbolReferences}
                  onRenameSymbol={openSymbolRename}
                />
              ) : (
                <TextProjectEditor
                  key={`${editorAttempt}:${projectGeneration}`}
                  path={activePath}
                  source={activeSource}
                  settings={editorSettings}
                  readOnly={draftConflict}
                  editorStates={textEditorStates.current}
                  onReady={onEditorReady}
                  onDocumentChange={onDocumentChange}
                  onError={onEditorError}
                  onRun={() => void run()}
                />
              )}
            </div>
          </Panel>
          <Separator className="playground-resize-handle" aria-label={t("resizePanels")} />
          <Panel id="output" className="playground-output-panel" defaultSize="40" minSize="25">
            <WorkspaceOutputPane
              showProblems={showProblems}
              diagnosticsCount={diagnostics.length}
              onShowProblemsChange={(show) => {
                setShowProblems(show);
                setShowResources(false);
              }}
              showDiff={showDiff}
              onShowDiffChange={(show) => {
                setShowDiff(show);
                setShowResources(false);
              }}
              showReferences={symbolReferencesOpen}
              referenceCount={symbolReferenceItems.length}
              onCloseReferences={closeSymbolReferences}
              onOpenReferences={openSymbolReferences}
              canCopyOutput={
                !showProblems &&
                !showDiff &&
                !symbolReferencesOpen &&
                (staleYaml !== undefined || reply?.result?.yaml !== undefined)
              }
              canDownloadOutput={
                !showProblems &&
                !showDiff &&
                !symbolReferencesOpen &&
                (staleYaml !== undefined || reply?.result?.yaml !== undefined)
              }
              canShowDiff={
                staleYaml === undefined &&
                Boolean(reply?.ok) &&
                previousYaml !== undefined &&
                previousYaml !== reply?.result?.yaml
              }
              onCopyOutput={() => void copyOutput()}
              onDownloadOutput={downloadOutput}
              orientation={orientation}
              onToggleOrientation={() => {
                const nextOrientation = orientation === "vertical" ? "horizontal" : "vertical";
                setOrientationOverridden(true);
                setOrientation(nextOrientation);
                saveLayoutPreference({
                  orientation: nextOrientation,
                  layout: panelGroup.current?.getLayout() ?? defaultPanelLayout,
                });
              }}
            >
              <PlaygroundResult
                reply={reply}
                diagnostics={diagnostics}
                navigablePaths={editablePaths}
                staleYaml={staleYaml}
                previousYaml={previousYaml}
                fontSize={editorSettings.fontSize}
                showDiff={showDiff}
                showProblems={showProblems}
                showResources={showResources}
                onToggleResources={() => setShowResources((shown) => !shown)}
                onShowResourcesChange={setShowResources}
                showReferences={symbolReferencesOpen}
                referenceItems={symbolReferenceItems}
                referenceError={symbolReferencesError}
                targetOutputPosition={targetOutputPosition}
                onDiagnostic={goToDiagnostic}
                sourcePosition={sourcePosition}
                onSourceCandidates={handleSourceCandidates}
              />
              {showProblems && draftsLoaded && diagnostics.length === 0 && (
                <p className="playground-no-problems">{t("noProblems")}</p>
              )}
            </WorkspaceOutputPane>
          </Panel>
        </Group>
        <footer className="playground-statusbar" aria-label={t("projectStatus")}>
          <span
            className={`playground-save-status playground-save-${saveStatus}`}
            aria-live="polite"
          >
            {
              {
                saving: t("saveSaving"),
                saved: t("saveSaved"),
                error: t("saveError"),
                conflict: t("saveConflict"),
              }[saveStatus]
            }
          </span>
          <span
            className={
              wasmStatus === "ready" ? "playground-status-ready" : "playground-status-loading"
            }
          >
            <span aria-hidden="true">●</span>{" "}
            {wasmStatus === "waiting"
              ? t("wasmWaiting")
              : {
                  fetching: t("wasmLoading"),
                  compiling: t("wasmLoading"),
                  initializing: t("wasmInitializing"),
                  ready: t("wasmReady"),
                  error: t("wasmError"),
                }[wasmStatus]}
          </span>
          {wasmStatus === "error" && (
            <button type="button" onClick={() => void retryWasm()}>
              {t("retry")}
            </button>
          )}
          <span>{t("problemsCount", { count: diagnostics.length })}</span>
          <span>{t("filesCount", { count: Object.keys(projectFiles).length + 1 })}</span>
          <span>{(projectSizeBytes / 1024 / 1024).toFixed(1)} MiB</span>
          <span className="playground-status-path">{activePath}</span>
        </footer>
        <PlaygroundEditorDialogs
          fileAction={fileAction}
          fileActionError={fileActionError}
          filePathInput={filePathInput}
          onFilePathInputChange={setFilePathInput}
          onCloseFileAction={() => setFileAction(undefined)}
          onSubmitFileAction={(event) => void submitFileAction(event)}
          onConfirmDeleteFile={confirmDeleteFile}
          symbolRenameOpen={symbolRenameOpen}
          hasPendingRename={pendingSymbolRename !== undefined}
          renamePreview={
            pendingSymbolRename
              ? renamePreviewEntries(pendingSymbolRename.edits, pendingSymbolRename.sources)
              : undefined
          }
          symbolRenameError={symbolRenameError}
          symbolRenameInput={symbolRenameInput}
          onSymbolRenameInputChange={setSymbolRenameInput}
          onCloseSymbolRename={closeSymbolRename}
          onResetSymbolRename={resetSymbolRename}
          onApplySymbolRename={() => void applySymbolRename()}
          onSubmitSymbolRename={(event) => void renameSymbol(event)}
          busy={busy}
          loadingProject={loadingProject}
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
        {notice && <p role="status">{notice}</p>}
      </section>
    </I18nProvider>
  );
}
