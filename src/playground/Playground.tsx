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
import type { RuntimeStatus } from "@manifest-configuration-language/browser";
import { createPlaygroundClient } from "./apiClient";
import { MclEditor, initialSource, type ApplyWorkspaceEdits } from "./MclEditor";
import { ProjectTabs } from "./ProjectTabs";
import { TextProjectEditor } from "./TextProjectEditor";
import {
  createSharedProjectPayload,
  decodeSharedProject,
  encodeSharedProject,
  parseSharedProjectPayload,
} from "./projectShare";
import { createShortShare, loadShortShare } from "./projectShareApi";
import { isValidProjectFileSet, isValidProjectPath, projectLimits } from "./projectValidation.js";
import { PlaygroundResult } from "./PlaygroundResult";
import { PlaygroundSettingsDialog } from "./PlaygroundSettingsDialog";
import { PlaygroundEditorDialogs } from "./PlaygroundEditorDialogs";
import { ProjectFileInput } from "./ProjectFileInput";
import type {
  PlaygroundDefinitionLocation,
  PlaygroundDiagnostic,
  PlaygroundReference,
  PlaygroundRenameEdit,
  PlaygroundReply,
  PlaygroundSourceMap,
  ProjectFile,
} from "./types";
import { writeProjectArchive } from "./projectZip";
import exampleCatalog from "./generatedExamples.json";
import { usePlaygroundProject } from "./usePlaygroundProject";
import { usePlaygroundRuntime } from "./usePlaygroundRuntime";
import { type QuickAccessItem } from "./QuickAccessList";
import { PlaygroundQuickAccessDialogs } from "./PlaygroundQuickAccessDialogs";
import "./symbolRenamePreview.css";
import {
  clearSharedDraftRecovery,
  isStoredProject,
  loadSharedDraftRecovery,
  resetSharedDraftRecovery,
  saveSharedDraftRecovery,
  usePlaygroundPersistence,
} from "./usePlaygroundPersistence";
import type {
  SharedDraftRecovery,
  SharedDraftRecoveryPatch,
  StoredProject,
} from "./usePlaygroundPersistence";

const layoutPreferenceKey = "mcl-playground-layout-v1";
const defaultPanelLayout: Layout = { editor: 60, output: 40 };

type LayoutPreference = {
  orientation: "horizontal" | "vertical";
  layout: Layout;
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

    return {
      orientation: preference.orientation,
      layout: { editor: layout.editor, output: layout.output },
    };
  } catch {
    return undefined;
  }
}

function saveLayoutPreference(preference: LayoutPreference) {
  try {
    localStorage.setItem(layoutPreferenceKey, JSON.stringify(preference));
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

type ExampleSpec = { category: string; title: string; slug: string; asset: string };
type FileAction = { kind: "create" } | { kind: "rename" | "delete"; path: string };
type PendingSymbolRename = {
  edits: PlaygroundRenameEdit[];
  sources: Record<string, string>;
  revision: number;
};
type RenamePreviewEntry = {
  path: string;
  line: number;
  before: string;
  after: string;
};
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

function clearSharedFragment() {
  const url = new URL(window.location.href);
  if (!url.hash.startsWith("#project=") && !url.searchParams.has("s")) return;
  if (url.hash.startsWith("#project=")) url.hash = "";
  url.searchParams.delete("s");
  history.replaceState(null, "", url);
}

function textForPath(project: StoredProject, path: string): string | undefined {
  if (path === "main.mcl") return project.source;
  const file = project.files[path];
  return file?.encoding === "utf8" ? file.content : undefined;
}

function diffProjectText(base: string, current: string): Omit<SharedDraftRecoveryPatch, "path"> {
  let prefix = 0;
  while (prefix < base.length && prefix < current.length && base[prefix] === current[prefix])
    prefix += 1;
  let suffix = 0;
  while (
    suffix < base.length - prefix &&
    suffix < current.length - prefix &&
    base[base.length - suffix - 1] === current[current.length - suffix - 1]
  )
    suffix += 1;
  return {
    start: prefix,
    end: base.length - suffix,
    insert: current.slice(prefix, current.length - suffix),
  };
}

function applySharedDraftRecovery(
  base: StoredProject,
  activePath: string,
  patches: SharedDraftRecoveryPatch[],
): StoredProject | undefined {
  const recovered: StoredProject = {
    source: base.source,
    files: { ...base.files },
    activePath,
  };
  for (const patch of patches) {
    if (
      !isValidProjectPath(patch.path) ||
      (patch.path !== "main.mcl" && base.files[patch.path]?.encoding === "binary")
    )
      return undefined;
    const source = textForPath(base, patch.path) ?? "";
    if (patch.start < 0 || patch.end < patch.start || patch.end > source.length) return undefined;
    const content = source.slice(0, patch.start) + patch.insert + source.slice(patch.end);
    if (patch.path === "main.mcl") recovered.source = content;
    else recovered.files[patch.path] = { encoding: "utf8", content };
  }
  if (activePath !== "main.mcl" && recovered.files[activePath]?.encoding !== "utf8")
    recovered.activePath = "main.mcl";
  const paths = ["main.mcl", ...Object.keys(recovered.files)];
  const encoder = new TextEncoder();
  const totalBytes =
    encoder.encode(recovered.source).byteLength +
    Object.values(recovered.files).reduce(
      (total, file) =>
        total +
        (file.encoding === "utf8"
          ? encoder.encode(file.content).byteLength
          : file.bytes.byteLength),
      0,
    );
  if (
    paths.length > projectLimits.projectFiles ||
    !isValidProjectFileSet(paths) ||
    totalBytes > projectLimits.projectBytes
  )
    return undefined;
  return recovered;
}

function sharedProjectError(cause: unknown, creating: boolean): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  if (message === "Project URL fragment exceeds 2 MiB")
    return creating
      ? "共有URLが2 MiBを超えています。ZIP形式で書き出してください。"
      : "共有URLが2 MiBを超えているため読み込めません。送信者にZIP形式で共有してもらってください。";
  if (message === "Shared project is too large")
    return "共有プロジェクトの展開サイズが上限を超えています。送信者に内容を小さくしてもらってください。";
  if (message === "Project serialization exceeds the share size limit")
    return creating
      ? "共有データのサイズ上限を超えています。ZIP形式で書き出してください。"
      : "共有データのサイズ上限を超えているため読み込めません。送信者にZIP形式で共有してもらってください。";
  return message;
}

function outputPositionForSource(
  sourceMap: PlaygroundSourceMap,
  source: EditorView,
  path: string,
): { line: number; character: number } | undefined {
  const cursor = source.state.selection.main.head;
  const sourceLine = source.state.doc.lineAt(cursor);
  const position = { line: sourceLine.number - 1, character: cursor - sourceLine.from };
  const candidates = sourceMap.entries.flatMap((entry) => {
    const origins = entry.sources.filter(
      (origin) =>
        origin.kind === "mcl" && origin.path === path && positionInRange(position, origin.range),
    );
    if (origins.length === 0) return [];
    if (
      entry.sources.length !== 1 ||
      origins[0].multiplicity !== "unique" ||
      origins[0].occurrences !== 1
    )
      return [undefined];
    return [entry.output.start];
  });
  if (candidates.length !== 1 || candidates[0] === undefined) return undefined;
  return candidates[0];
}

function positionInRange(
  position: { line: number; character: number },
  range: PlaygroundSourceMap["entries"][number]["output"],
): boolean {
  const afterStart =
    position.line > range.start.line ||
    (position.line === range.start.line && position.character >= range.start.character);
  const beforeEnd =
    position.line < range.end.line ||
    (position.line === range.end.line && position.character < range.end.character);
  return afterStart && beforeEnd;
}

function sourceOffsetAt(source: string, position: { line: number; character: number }) {
  let offset = 0;
  for (let line = 0; line < position.line; line += 1) {
    const newline = source.indexOf("\n", offset);
    if (newline < 0) return undefined;
    offset = newline + 1;
  }
  const lineEnd = source.indexOf("\n", offset);
  const contentEnd = lineEnd < 0 ? source.length : lineEnd;
  if (position.character < 0 || offset + position.character > contentEnd) return undefined;
  return offset + position.character;
}

function renamePreviewEntries(
  edits: PlaygroundRenameEdit[],
  sources: Record<string, string>,
): RenamePreviewEntry[] | undefined {
  const entries = edits.map((edit) => {
    const source = sources[edit.path];
    if (source === undefined) return undefined;
    const from = sourceOffsetAt(source, edit.range.start);
    const to = sourceOffsetAt(source, edit.range.end);
    if (from === undefined || to === undefined || from > to) return undefined;
    return {
      path: edit.path,
      line: edit.range.start.line + 1,
      before: source.slice(from, to),
      after: edit.newText,
    };
  });
  if (entries.some((entry) => entry === undefined)) return undefined;
  return (entries as RenamePreviewEntry[]).sort(
    (left, right) => left.path.localeCompare(right.path) || left.line - right.line,
  );
}

export default function Playground() {
  const examples = exampleCatalog as unknown as ExampleSpec[];
  const {
    project,
    projectRef,
    replace: replaceProjectState,
    setFileContent,
    select: selectProjectFile,
    createFile: createProjectFile,
    renameFile: renameProjectFile,
    deleteFile: deleteProjectFile,
  } = usePlaygroundProject(initialSource);
  const editor = useRef<EditorView | undefined>(undefined);
  const mclEditorStates = useRef(new Map<string, EditorState>());
  const textEditorStates = useRef(new Map<string, EditorState>());
  const workspaceEditApplier = useRef<ApplyWorkspaceEdits | undefined>(undefined);
  const client = useRef<ReturnType<typeof createPlaygroundClient> | undefined>(undefined);
  const revision = useRef(0);
  const runAction = useRef<() => void>(() => {});
  const sharedRecovery = useRef<{ metadata: SharedDraftRecovery; base: StoredProject } | undefined>(
    undefined,
  );
  const pendingNavigation = useRef<PlaygroundDiagnostic | undefined>(undefined);
  const panelGroup = useGroupRef();
  const startupReady = useRef(false);
  const [renderState, dispatchRender] = useReducer(renderStateReducer, initialRenderState);
  const reply = renderState.reply;
  const staleYaml = renderState.stale ? renderState.latestSuccess?.result?.yaml : undefined;
  const previousYaml = renderState.previousYaml;
  const [showDiff, setShowDiff] = useState(false);
  const [showProblems, setShowProblems] = useState(false);
  const [targetOutputPosition, setTargetOutputPosition] = useState<
    { line: number; character: number; requestId: number } | undefined
  >();
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
  const [symbolRenameOpen, setSymbolRenameOpen] = useState(false);
  const [symbolRenameInput, setSymbolRenameInput] = useState("");
  const [symbolRenameError, setSymbolRenameError] = useState("");
  const [pendingSymbolRename, setPendingSymbolRename] = useState<PendingSymbolRename>();
  const [symbolReferences, setSymbolReferences] = useState<PlaygroundReference[]>([]);
  const [symbolReferencesError, setSymbolReferencesError] = useState("");
  const [symbolReferencesOpen, setSymbolReferencesOpen] = useState(false);

  const reportPersistenceError = useCallback(
    (cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)),
    [],
  );
  const {
    editorSettings,
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
    loadLegacyProject,
    markDraftsLoaded,
  } = usePlaygroundPersistence(project, reportPersistenceError);

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
    reply?.ok && reply.revision === revision.current ? reply.result?.sourceMap : undefined;
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
        setSymbolReferencesOpen(false);
      },
    };
  });
  const commands = [
    { name: "実行", action: () => void run() },
    ...(activePath.endsWith(".mcl") ? [{ name: "整形", action: () => void formatSource() }] : []),
    {
      name: "コメントを切り替え",
      action: () => {
        const view = editor.current;
        if (!view) return;
        view.focus();
        toggleComment(view);
      },
    },
    {
      name: "次の一致を選択",
      action: () => {
        const view = editor.current;
        if (!view) return;
        view.focus();
        selectNextOccurrence(view);
      },
    },
    {
      name: "すべての一致を選択",
      action: () => {
        const view = editor.current;
        if (!view) return;
        view.focus();
        selectSelectionMatches(view);
      },
    },
    { name: "サンプルを開く", action: () => setExamplesOpen(true) },
    {
      name: "ファイル一覧を切り替え",
      action: () => setExplorerOpen((value) => !value),
    },
    ...(activePath.endsWith(".mcl")
      ? [{ name: "定義へ移動", action: () => void goToDefinitionAtCursor() }]
      : []),
    ...(currentSourceMap && activePath.endsWith(".mcl")
      ? [{ name: "YAMLの対応箇所へ移動", action: navigateToYaml }]
      : []),
    ...(activePath.endsWith(".mcl")
      ? [
          {
            name: "参照箇所を検索",
            action: () => void findSymbolReferences(),
          },
          {
            name: "シンボル名を変更",
            action: openSymbolRename,
          },
        ]
      : []),
    {
      name: "共有",
      action: () => void shareProject(),
    },
    {
      name: "ファイルを開く",
      action: () => {
        setQuickOpen(true);
      },
    },
    {
      name: "ファイルを作成",
      action: () => {
        setFileActionError("");
        setFilePathInput("");
        setFileAction({ kind: "create" });
      },
    },
    { name: "新しいプロジェクト", action: () => createDraft() },
    { name: "出力を表示", action: () => setMobileView("output") },
    {
      name: "問題を表示",
      action: () => {
        setMobileView("problems");
        setShowProblems(true);
        setShowDiff(false);
      },
    },
  ];
  const commandShortcuts: Record<string, string> = {
    実行: "Ctrl/⌘ Enter",
    整形: "Shift+Alt+F",
    コメントを切り替え: "Ctrl/⌘ /",
    次の一致を選択: "Ctrl/⌘ D",
    すべての一致を選択: "Ctrl/⌘ ⇧ L",
    定義へ移動: "F12",
    参照箇所を検索: "Shift+F12",
    シンボル名を変更: "F2",
    ファイルを開く: "Ctrl/⌘ P",
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
    setDiagnostics([]);
    dispatchRender({ type: "source-changed" });
    setShowDiff(false);
    setBusy(false);
    if (startupReady.current) scheduleLint(projectRef.current.source, currentRevision);

    const recovery = sharedRecovery.current;
    if (!recovery) {
      clearSharedFragment();
      return;
    }
    try {
      const snapshot = projectRef.current;
      const fragment = await encodeSharedProject({
        source: snapshot.source,
        files: snapshot.files,
        activePath: snapshot.activePath,
      });
      if (snapshot !== projectRef.current) return;
      const metadata = {
        draftId: recovery.metadata.draftId,
        fragment,
        activePath: snapshot.activePath,
      };
      resetSharedDraftRecovery(metadata);
      sharedRecovery.current = { metadata, base: snapshot };
      if (window.location.hash.startsWith("#project=")) {
        history.replaceState(
          null,
          "",
          `${window.location.pathname}${window.location.search}${fragment}`,
        );
      }
      await saveDraftSnapshot(metadata.draftId, snapshot);
      clearSharedFragment();
    } catch (cause) {
      setError(sharedProjectError(cause, true));
    }
  }

  function languageServiceFiles(): Record<string, ProjectFile> {
    const files = Object.assign(Object.create(null), projectRef.current.files) as Record<
      string,
      ProjectFile
    >;
    files["main.mcl"] = { encoding: "utf8", content: projectRef.current.source };
    return files;
  }

  const applyProject = useCallback(
    (project: StoredProject, options: { newDraft?: boolean; name?: string } = {}) => {
      mclEditorStates.current.clear();
      textEditorStates.current.clear();
      if (options.newDraft !== false) {
        clearSharedFragment();
        clearSharedDraftRecovery(activeDraftIdRef.current);
        sharedRecovery.current = undefined;
        void saveDraftSnapshot(activeDraftIdRef.current, projectRef.current).catch(
          (cause: unknown) => {
            setError(cause instanceof Error ? cause.message : String(cause));
          },
        );
        activateDraft(crypto.randomUUID(), options.name ?? "インポート");
      }
      dispatchRender({ type: "project-replaced" });
      setShowDiff(false);
      const requestedPath = project.activePath;
      const nextPath =
        requestedPath &&
        (requestedPath === "main.mcl" || project.files[requestedPath]?.encoding === "utf8")
          ? requestedPath
          : "main.mcl";
      replaceProjectState(project.source, project.files, nextPath);
      setOpenPaths([nextPath]);
      void saveDraftSnapshot(activeDraftIdRef.current, projectRef.current).catch(
        (cause: unknown) => {
          setError(cause instanceof Error ? cause.message : String(cause));
        },
      );
      setProjectGeneration((value) => value + 1);
      setBusy(false);
      setError("");
      const currentRevision = ++revision.current;
      setDiagnostics([]);
      if (startupReady.current) scheduleLint(project.source, currentRevision);
    },
    [activateDraft, projectRef, replaceProjectState, saveDraftSnapshot, scheduleLint],
  );

  useEffect(() => {
    const preference = readLayoutPreference();
    if (!preference) return;
    setOrientation(preference.orientation);
    panelGroup.current?.setLayout(preference.layout);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const createdClient = createPlaygroundClient(
      (status) => {
        if (!cancelled) setWasmStatus(status);
      },
      ({ operation, durationMs, outcome }) => {
        if (cancelled) return;
        const name = `mcl.playground.${operation}.${outcome}`;
        const end = performance.now();
        performance.clearMeasures(name);
        performance.measure(name, {
          start: Math.max(0, end - durationMs),
          duration: durationMs,
          detail: { operation, outcome },
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

      let recoveredSharedDraft = false;
      const shortShareId = new URL(window.location.href).searchParams.get("s");
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
            clearSharedDraftRecovery();
            restored = shared;
            activeId = crypto.randomUUID();
            activateDraft(activeId, "共有プロジェクト");
            sharedRecovery.current = {
              metadata: {
                draftId: activeId,
                fragment: window.location.hash,
                activePath: shared.activePath ?? "main.mcl",
              },
              base: shared,
            };
          } else if (!window.location.hash.startsWith("#project=")) {
            const savedRecovery = loadSharedDraftRecovery();
            if (savedRecovery) {
              const base = await decodeSharedProject(savedRecovery.metadata.fragment);
              const recovered = base
                ? applySharedDraftRecovery(
                    base,
                    savedRecovery.metadata.activePath,
                    savedRecovery.patches,
                  )
                : undefined;
              if (base && recovered) {
                restored = recovered;
                activeId = savedRecovery.metadata.draftId;
                await setActiveDraft(activeId);
                if (!draftsRef.current.some((draft) => draft.id === activeId))
                  updateDraftMetadata(activeId, "共有プロジェクト");
                sharedRecovery.current = { metadata: savedRecovery.metadata, base };
                recoveredSharedDraft = true;
              } else {
                clearSharedDraftRecovery();
              }
            }
          }
        }
      } catch (cause) {
        if (!cancelled) setError(sharedProjectError(cause, false));
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
            if (sharedRecovery.current) {
              clearSharedDraftRecovery(sharedRecovery.current.metadata.draftId);
              sharedRecovery.current = undefined;
              recoveredSharedDraft = false;
            }
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
        applyProject(restored, { newDraft: false });
        if (recoveredSharedDraft) {
          try {
            await saveDraftSnapshot(activeId, projectRef.current);
          } catch (cause) {
            if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
          }
        }
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
    const root = document.documentElement;
    if (editorSettings.theme === "system") root.removeAttribute("data-playground-theme");
    else root.dataset.playgroundTheme = editorSettings.theme;
    return () => root.removeAttribute("data-playground-theme");
  }, [editorSettings.theme]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (document.querySelector("dialog[open]")) return;
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
      const previousProject = projectRef.current;
      let recoveryError: string | undefined;
      if (!sharedRecovery.current && window.location.hash.startsWith("#project=")) {
        sharedRecovery.current = {
          metadata: {
            draftId: activeDraftIdRef.current,
            fragment: window.location.hash,
            activePath: previousProject.activePath,
          },
          base: {
            source: previousProject.source,
            files: previousProject.files,
            activePath: previousProject.activePath,
          },
        };
      }
      const result = setFileContent(path, source);
      if (!result.ok) {
        setError(result.error);
        return false;
      }
      const recovery = sharedRecovery.current;
      if (recovery) {
        const metadata = { ...recovery.metadata, activePath: path };
        const patch = diffProjectText(textForPath(recovery.base, path) ?? "", source);
        try {
          saveSharedDraftRecovery(metadata, { path, ...patch });
          recovery.metadata = metadata;
          clearSharedFragment();
        } catch (cause) {
          recoveryError = `共有プロジェクトの編集をタブ内に保存できません: ${cause instanceof Error ? cause.message : String(cause)}`;
        }
      }
      setRecentPaths((previous) => [path, ...previous.filter((entry) => entry !== path)]);
      const currentRevision = ++revision.current;
      setDiagnostics([]);
      dispatchRender({ type: "source-changed" });
      setShowDiff(false);
      setError(recoveryError ?? "");
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
      if (sharedRecovery.current?.metadata.draftId === activeDraftIdRef.current) {
        clearSharedDraftRecovery(activeDraftIdRef.current);
        sharedRecovery.current = undefined;
      }
      await setActiveDraft(id);
      clearSharedFragment();
      applyProject(saved, { newDraft: false });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  function createDraft() {
    applyProject({ source: initialSource, files: {} }, { name: "プロジェクト" });
  }

  async function exportProject() {
    try {
      const archive = await writeProjectArchive({
        source: projectRef.current.source,
        files: projectRef.current.files,
      });
      const url = URL.createObjectURL(archive);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "mcl-project.zip";
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice("ZIPを書き出しました");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function shareProject() {
    const draftId = activeDraftIdRef.current;
    const snapshot = projectRef.current;
    try {
      await saveDraftSnapshot(draftId, snapshot);
      const payload = createSharedProjectPayload({
        source: snapshot.source,
        files: snapshot.files,
        activePath: snapshot.activePath,
      });
      let shareURL: URL;
      let shareNotice = "共有URLをコピーしました";
      try {
        const created = await createShortShare(payload, AbortSignal.timeout(15_000));
        shareURL = new URL(window.location.href);
        shareURL.hash = "";
        shareURL.searchParams.delete("example");
        shareURL.searchParams.set("s", created.id);
        clearSharedDraftRecovery(draftId);
        sharedRecovery.current = undefined;
        const expiration = new Intl.DateTimeFormat("ja-JP", { dateStyle: "long" }).format(
          new Date(created.expiresAt),
        );
        shareNotice = `共有URLをコピーしました（${expiration}まで有効。URLを知る人は閲覧できます）`;
      } catch {
        const fragment = await encodeSharedProject(snapshot);
        shareURL = new URL(window.location.href);
        shareURL.searchParams.delete("s");
        shareURL.hash = fragment.slice(1);
        const metadata = { draftId, fragment, activePath: snapshot.activePath };
        resetSharedDraftRecovery(metadata);
        sharedRecovery.current = {
          metadata,
          base: {
            source: snapshot.source,
            files: snapshot.files,
            activePath: snapshot.activePath,
          },
        };
      }
      await navigator.clipboard.writeText(shareURL.href);
      history.replaceState(null, "", shareURL);
      setNotice(shareNotice);
    } catch (cause) {
      setError(sharedProjectError(cause, true));
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

  function downloadOutput() {
    const yaml = staleYaml ?? reply?.result?.yaml;
    if (yaml === undefined) return;
    const url = URL.createObjectURL(new Blob([yaml], { type: "application/yaml;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "manifest.yaml";
    anchor.click();
    URL.revokeObjectURL(url);
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

  function navigateToDefinition(location: PlaygroundDefinitionLocation) {
    if (!mclPaths.includes(location.path)) return;
    setMobileView("editor");
    const navigation: PlaygroundDiagnostic = {
      code: "MCL-NAVIGATION",
      message: "",
      severity: "info",
      path: location.path,
      line: location.range.start.line + 1,
      column: location.range.start.character + 1,
    };
    if (location.path !== projectRef.current.activePath) {
      selectFile(location.path, navigation);
      return;
    }
    goToEditorPosition(navigation);
  }

  async function goToDefinitionAtCursor() {
    const view = editor.current;
    const playground = client.current;
    const path = projectRef.current.activePath;
    if (!view || !playground || !path.endsWith(".mcl")) return;

    const cursor = view.state.selection.main.head;
    const sourceLine = view.state.doc.lineAt(cursor);
    const position = { line: sourceLine.number - 1, character: cursor - sourceLine.from };
    const currentRevision = revision.current;
    setError("");
    setNotice("");
    try {
      const location = await playground.definition(
        view.state.doc.toString(),
        path,
        position,
        languageServiceFiles(),
      );
      if (currentRevision !== revision.current || editor.current !== view) return;
      if (location) navigateToDefinition(location);
      else setNotice("この位置に定義はありません");
    } catch (cause) {
      if (currentRevision !== revision.current || editor.current !== view) return;
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function findSymbolReferences() {
    const view = editor.current;
    const playground = client.current;
    const path = projectRef.current.activePath;
    if (!view || !playground || !path.endsWith(".mcl")) return;

    const cursor = view.state.selection.main.head;
    const sourceLine = view.state.doc.lineAt(cursor);
    const position = { line: sourceLine.number - 1, character: cursor - sourceLine.from };
    const source = view.state.doc.toString();
    const currentRevision = revision.current;
    setSymbolReferencesError("");
    setSymbolReferences([]);
    try {
      const references = await playground.references(
        source,
        path,
        position,
        languageServiceFiles(),
      );
      if (currentRevision !== revision.current || editor.current !== view) return;
      setSymbolReferences(references.filter((reference) => mclPaths.includes(reference.path)));
      setSymbolReferencesOpen(true);
    } catch (cause) {
      if (currentRevision !== revision.current || editor.current !== view) return;
      setSymbolReferencesError(cause instanceof Error ? cause.message : String(cause));
      setSymbolReferencesOpen(true);
    }
  }

  function navigateToSourceMapLocation(path: string, line: number, character: number) {
    if (!mclPaths.includes(path)) return;
    const navigation: PlaygroundDiagnostic = {
      code: "MCL-SOURCE-MAP",
      message: "",
      severity: "info",
      path,
      line: line + 1,
      column: character + 1,
    };
    setMobileView("editor");
    if (path !== projectRef.current.activePath) {
      selectFile(path, navigation);
      return;
    }
    goToEditorPosition(navigation);
  }

  function navigateToYaml() {
    const view = editor.current;
    if (!view || !currentSourceMap || !activePath.endsWith(".mcl")) return;
    const position = outputPositionForSource(currentSourceMap, view, activePath);
    if (!position) return;
    setTargetOutputPosition({ ...position, requestId: reply!.requestId });
    setShowProblems(false);
    setShowDiff(false);
    setMobileView("output");
  }

  async function renameSymbol(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const view = editor.current;
    const playground = client.current;
    const path = projectRef.current.activePath;
    const newName = symbolRenameInput.trim();
    if (!view || !playground || !path.endsWith(".mcl") || !newName) return;

    const cursor = view.state.selection.main.head;
    const sourceLine = view.state.doc.lineAt(cursor);
    const position = { line: sourceLine.number - 1, character: cursor - sourceLine.from };
    const source = view.state.doc.toString();
    const currentRevision = revision.current;
    setSymbolRenameError("");
    try {
      const edits = await playground.rename(
        source,
        path,
        position,
        newName,
        languageServiceFiles(),
      );
      if (currentRevision !== revision.current || editor.current !== view) return;
      if (edits.length === 0) {
        setSymbolRenameError("この位置に変更可能なシンボルがありません。");
        return;
      }
      if (edits.some((edit) => !mclPaths.includes(edit.path))) {
        setSymbolRenameError("変更対象にプロジェクト内のMCLファイル以外が含まれています。");
        return;
      }
      const applyEdits = workspaceEditApplier.current;
      if (!applyEdits) {
        setSymbolRenameError("エディターの準備が完了していません。");
        return;
      }
      const sources: Record<string, string> = Object.create(null);
      for (const edit of edits) {
        sources[edit.path] =
          edit.path === path ? view.state.doc.toString() : sourceForPath(edit.path);
      }
      const preview = renamePreviewEntries(edits, sources);
      if (!preview) {
        setSymbolRenameError("変更位置を確認できません。");
        return;
      }
      setPendingSymbolRename({ edits, sources, revision: currentRevision });
    } catch (cause) {
      setSymbolRenameError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function applySymbolRename() {
    const pending = pendingSymbolRename;
    const applyEdits = workspaceEditApplier.current;
    if (!pending || !applyEdits) return;
    if (pending.revision !== revision.current) {
      setSymbolRenameError("ソースが変更されています。もう一度プレビューしてください。");
      setPendingSymbolRename(undefined);
      return;
    }

    const applied = applyEdits(pending.edits, pending.sources);
    if (!applied.ok) {
      setSymbolRenameError(applied.error);
      setPendingSymbolRename(undefined);
      return;
    }

    const currentProject = projectRef.current;
    let nextSource = currentProject.source;
    const nextFiles = Object.assign(Object.create(null), currentProject.files) as Record<
      string,
      ProjectFile
    >;
    for (const [editedPath, content] of Object.entries(applied.documents)) {
      if (editedPath === "main.mcl") nextSource = content;
      else nextFiles[editedPath] = { encoding: "utf8", content };
    }
    replaceProjectState(nextSource, nextFiles, currentProject.activePath);
    await finishProjectMutation();
    setSymbolRenameOpen(false);
    setPendingSymbolRename(undefined);
    setNotice("シンボル名を変更しました");
  }

  function openSymbolRename() {
    setSymbolRenameError("");
    setSymbolRenameInput("");
    setPendingSymbolRename(undefined);
    setSymbolRenameOpen(true);
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

  function submitFileAction(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!fileAction || fileAction.kind === "delete") return;
    const path = filePathInput.trim();
    const result =
      fileAction.kind === "create"
        ? createProjectFile(path)
        : renameProjectFile(fileAction.path, path);
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
    <section className="playground" aria-label="MCLプレイグラウンド" aria-busy={loadingProject}>
      <header className="playground-header">
        <div className="playground-brand">
          <a href="/" aria-label="MCLドキュメント">
            MCL
          </a>
          <span aria-hidden="true" className="playground-brand-separator">
            /
          </span>
          <span>Playground</span>
        </div>
        <div className="playground-toolbar">
          <div className="playground-primary-actions" role="group" aria-label="編集操作">
            {busy || renderPending ? (
              <button type="button" onClick={cancel}>
                中断
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
                  実行
                  <kbd>Ctrl/⌘ Enter</kbd>
                </button>
                <button
                  type="button"
                  onClick={formatSource}
                  aria-keyshortcuts="Shift+Alt+F"
                  disabled={
                    !draftsLoaded ||
                    loadingProject ||
                    Boolean(editorError) ||
                    !activePath.endsWith(".mcl")
                  }
                >
                  コードを整形
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => setExamplesOpen(true)}
              disabled={!draftsLoaded || busy || loadingProject}
              aria-haspopup="dialog"
            >
              サンプル
            </button>
          </div>
          <div className="playground-secondary-actions">
            <button
              className="playground-command-button"
              type="button"
              onClick={() => setCommandPaletteOpen(true)}
              aria-keyshortcuts="Control+Shift+P Meta+Shift+P"
            >
              コマンド検索
              <kbd>Ctrl/⌘ ⇧ P</kbd>
            </button>
            <details className="playground-more">
              <summary>プロジェクト</summary>
              <div className="playground-more-menu">
                <label className="playground-project-picker">
                  <span>プロジェクトを開く</span>
                  <select
                    aria-label="プロジェクトを開く"
                    value={activeDraftId}
                    disabled={!draftsLoaded || busy || loadingProject}
                    onChange={(event) => void openDraft(event.currentTarget.value)}
                  >
                    {drafts.map((draft) => (
                      <option key={draft.id} value={draft.id}>
                        {draft.name === "作業" ? "無題のプロジェクト" : draft.name}
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
                    新しいプロジェクト
                  </button>
                  <button
                    type="button"
                    onClick={shareProject}
                    disabled={!draftsLoaded || busy || loadingProject}
                  >
                    共有リンクをコピー
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
                <a href="/playground/capabilities/">対応機能</a>
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
            group: "基本",
            keywords: ["基本", "変数", "manifest"],
            onSelect: () => void selectSample("configMap"),
          },
          {
            value: "deployment",
            label: "Deployment",
            group: "基本",
            keywords: ["基本", "kubernetes", "manifest"],
            onSelect: () => void selectSample("deployment"),
          },
          ...examples.map((entry) => ({
            value: entry.slug,
            label: entry.title,
            group: entry.category,
            keywords: [entry.category, entry.slug],
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
      {loadingProject && <p role="status">読み込み中</p>}
      <nav className="playground-mobile-views" aria-label="表示">
        <button
          type="button"
          aria-pressed={mobileView === "editor"}
          onClick={() => setMobileView("editor")}
        >
          エディター
        </button>
        <button
          type="button"
          aria-pressed={mobileView === "output"}
          onClick={() => {
            setMobileView("output");
            setShowProblems(false);
          }}
        >
          出力
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
          問題{diagnostics.length > 0 ? ` ${diagnostics.length}` : ""}
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
              aria-label={explorerOpen ? "ファイル一覧を閉じる" : "ファイル一覧を開く"}
              aria-pressed={explorerOpen}
              onClick={() => setExplorerOpen((value) => !value)}
              title={explorerOpen ? "ファイル一覧を閉じる" : "ファイル一覧を開く"}
            >
              ▤
            </button>
            <div className="playground-file-tabs" role="group" aria-label="開いているファイル">
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
                      aria-label={`${path}を閉じる`}
                      title="閉じる"
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
              disabled={!draftsLoaded || busy || loadingProject}
              title="ファイルを作成"
              aria-label="ファイルを作成"
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
                disabled={!draftsLoaded || busy || loadingProject}
              />
            )}
            {activePath.endsWith(".mcl") ? (
              <MclEditor
                key={`${editorAttempt}:${projectGeneration}`}
                path={activePath}
                paths={projectPaths}
                source={activeSource}
                settings={editorSettings}
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
                onNavigateToYaml={navigateToYaml}
                onShowProblems={() => {
                  setMobileView("problems");
                  setShowProblems(true);
                  setShowDiff(false);
                }}
                onFindReferences={() => void findSymbolReferences()}
                onRenameSymbol={openSymbolRename}
              />
            ) : (
              <TextProjectEditor
                key={`${editorAttempt}:${projectGeneration}`}
                path={activePath}
                source={activeSource}
                settings={editorSettings}
                editorStates={textEditorStates.current}
                onReady={onEditorReady}
                onDocumentChange={onDocumentChange}
                onError={onEditorError}
                onRun={() => void run()}
              />
            )}
          </div>
        </Panel>
        <Separator className="playground-resize-handle" aria-label="エディターと結果の配置を変更" />
        <Panel id="output" className="playground-output-panel" defaultSize="40" minSize="25">
          <div className="playground-result-panel">
            <div className="playground-result-toolbar">
              <div className="playground-result-tabs" role="group" aria-label="結果表示">
                <button
                  type="button"
                  aria-pressed={!showProblems && !showDiff}
                  onClick={() => {
                    setShowProblems(false);
                    setShowDiff(false);
                  }}
                >
                  YAML
                </button>
                <button
                  type="button"
                  aria-pressed={showProblems}
                  onClick={() => {
                    setShowProblems(true);
                    setShowDiff(false);
                  }}
                >
                  問題{diagnostics.length > 0 ? ` ${diagnostics.length}` : ""}
                </button>
                <button
                  type="button"
                  aria-pressed={showDiff}
                  onClick={() => {
                    setShowProblems(false);
                    setShowDiff(true);
                  }}
                  disabled={
                    staleYaml !== undefined ||
                    !reply?.ok ||
                    previousYaml === undefined ||
                    previousYaml === reply.result?.yaml
                  }
                >
                  差分
                </button>
              </div>
              <button
                type="button"
                onClick={() => void copyOutput()}
                disabled={
                  showProblems ||
                  showDiff ||
                  (staleYaml === undefined && reply?.result?.yaml === undefined)
                }
              >
                コピー
              </button>
              <button
                type="button"
                onClick={downloadOutput}
                disabled={
                  showProblems ||
                  showDiff ||
                  (staleYaml === undefined && reply?.result?.yaml === undefined)
                }
              >
                ダウンロード
              </button>
              <button
                type="button"
                className="playground-layout-toggle"
                onClick={() => {
                  const nextOrientation = orientation === "vertical" ? "horizontal" : "vertical";
                  setOrientation(nextOrientation);
                  saveLayoutPreference({
                    orientation: nextOrientation,
                    layout: panelGroup.current?.getLayout() ?? defaultPanelLayout,
                  });
                }}
                aria-label={orientation === "vertical" ? "左右に並べる" : "上下に並べる"}
                title={orientation === "vertical" ? "左右に並べる" : "上下に並べる"}
              >
                {orientation === "vertical" ? "左右" : "上下"}
              </button>
            </div>
            <PlaygroundResult
              reply={reply}
              diagnostics={diagnostics}
              navigablePaths={editablePaths}
              staleYaml={staleYaml}
              previousYaml={previousYaml}
              fontSize={editorSettings.fontSize}
              showDiff={showDiff}
              showProblems={showProblems}
              targetOutputPosition={targetOutputPosition}
              onDiagnostic={goToDiagnostic}
              onSourceLocation={navigateToSourceMapLocation}
            />
            {showProblems && draftsLoaded && diagnostics.length === 0 && (
              <p className="playground-no-problems">問題はありません</p>
            )}
          </div>
        </Panel>
      </Group>
      <footer className="playground-statusbar" aria-label="プロジェクトの状態">
        <span
          className={
            wasmStatus === "ready" ? "playground-status-ready" : "playground-status-loading"
          }
        >
          <span aria-hidden="true">●</span>{" "}
          {wasmStatus === "waiting"
            ? "WASM準備中"
            : {
                fetching: "WASMダウンロード中",
                compiling: "WASMコンパイル中",
                initializing: "WASM初期化中",
                ready: "WASM",
                error: "WASMエラー",
              }[wasmStatus]}
        </span>
        <span>{diagnostics.length}件の問題</span>
        <span>{Object.keys(projectFiles).length + 1}ファイル</span>
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
        onCloseSymbolRename={() => {
          setSymbolRenameOpen(false);
          setPendingSymbolRename(undefined);
        }}
        onResetSymbolRename={() => {
          setPendingSymbolRename(undefined);
          setSymbolRenameError("");
        }}
        onApplySymbolRename={() => void applySymbolRename()}
        onSubmitSymbolRename={(event) => void renameSymbol(event)}
        busy={busy}
        loadingProject={loadingProject}
        symbolReferencesOpen={symbolReferencesOpen}
        symbolReferencesError={symbolReferencesError}
        symbolReferenceItems={symbolReferenceItems}
        onCloseSymbolReferences={() => setSymbolReferencesOpen(false)}
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
  );
}
