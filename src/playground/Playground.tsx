import { Group, Panel, Separator } from "react-resizable-panels";
import { useCallback, useEffect, useRef, useState, type SyntheticEvent } from "react";
import type { EditorView } from "@codemirror/view";
import { createPlaygroundClient } from "./apiClient";
import {
  MclEditor,
  initialSource,
  type ApplyWorkspaceEdits,
  type EditorSettings,
} from "./MclEditor";
import { ProjectTabs } from "./ProjectTabs";
import { decodeSharedProject, encodeSharedProject } from "./projectShare";
import { isValidProjectFileSet, isValidProjectPath, projectLimits } from "./projectValidation.js";
import { PlaygroundResult } from "./PlaygroundResult";
import { ProjectFileInput } from "./ProjectFileInput";
import type {
  PlaygroundDefinitionLocation,
  PlaygroundDiagnostic,
  PlaygroundReference,
  PlaygroundReply,
  PlaygroundSourceMap,
  ProjectFile,
} from "./types";
import { writeProjectArchive } from "./projectZip";
import exampleCatalog from "./generatedExamples.json";
import { usePlaygroundProject } from "./usePlaygroundProject";
import { usePlaygroundRuntime } from "./usePlaygroundRuntime";
import { QuickAccessList, type QuickAccessItem } from "./QuickAccessList";
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
  if (!window.location.hash.startsWith("#project=")) return;
  history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
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
  const workspaceEditApplier = useRef<ApplyWorkspaceEdits | undefined>(undefined);
  const client = useRef<ReturnType<typeof createPlaygroundClient> | undefined>(undefined);
  const revision = useRef(0);
  const runAction = useRef<() => void>(() => {});
  const latestYaml = useRef<string | undefined>(undefined);
  const sharedRecovery = useRef<{ metadata: SharedDraftRecovery; base: StoredProject } | undefined>(
    undefined,
  );
  const pendingNavigation = useRef<PlaygroundDiagnostic | undefined>(undefined);
  const quickOpenDialog = useRef<HTMLDialogElement>(null);
  const examplesDialog = useRef<HTMLDialogElement>(null);
  const commandPaletteDialog = useRef<HTMLDialogElement>(null);
  const fileActionDialog = useRef<HTMLDialogElement>(null);
  const symbolRenameDialog = useRef<HTMLDialogElement>(null);
  const symbolReferencesDialog = useRef<HTMLDialogElement>(null);
  const startupReady = useRef(false);
  const applyingSample = useRef(false);
  const [reply, setReply] = useState<PlaygroundReply>();
  const [staleYaml, setStaleYaml] = useState<string>();
  const [previousYaml, setPreviousYaml] = useState<string>();
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
  const [wasmReady, setWasmReady] = useState(false);
  const [orientation, setOrientation] = useState<"horizontal" | "vertical">("vertical");
  const [sample, setSample] = useState("configMap");
  const [examplesOpen, setExamplesOpen] = useState(false);
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
    setDraftShare,
    activateDraft,
    updateDraftMetadata,
    saveDraftSnapshot,
    loadDraftIndex,
    loadActiveDraftId,
    loadDraft,
    loadLegacyProject,
    markDraftsLoaded,
  } = usePlaygroundPersistence(project, reportPersistenceError);

  const handleLintResult = useCallback((result: PlaygroundReply, currentRevision: number) => {
    const currentDiagnostics = result.ok
      ? (result.diagnostics ?? [])
      : result.error
        ? [result.error]
        : [];
    setDiagnostics(currentDiagnostics);
    setReply((previous) => ({
      ...(previous ?? { requestId: currentRevision, revision: currentRevision, ok: false }),
      ok: false,
      result: undefined,
      error: undefined,
      diagnostics: currentDiagnostics,
    }));
  }, []);
  const handleWasmReady = useCallback(() => setWasmReady(true), []);
  const runtime = usePlaygroundRuntime({
    client,
    project: projectRef,
    revision,
    onLint: handleLintResult,
    onWasmReady: handleWasmReady,
  });
  const {
    isRendering,
    renderPending,
    run: runWasm,
    scheduleLint,
    trackRequest: trackWasmRequest,
  } = runtime;

  const editablePaths = [
    "main.mcl",
    ...Object.entries(projectFiles)
      .filter(([, file]) => file.encoding === "utf8")
      .map(([path]) => path)
      .sort(),
  ];
  const mclPaths = editablePaths.filter((path) => path.endsWith(".mcl"));
  const currentSourceMap =
    reply?.ok && reply.revision === revision.current ? reply.result?.sourceMap : undefined;
  const projectPaths = ["main.mcl", ...Object.keys(projectFiles).sort()];
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
  const commands = [
    { name: "実行", action: () => void run() },
    { name: "整形", action: () => void formatSource() },
    { name: "サンプルを開く", action: () => setExamplesOpen(true) },
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
    定義へ移動: "F12",
    参照箇所を検索: "Shift+F12",
    シンボル名を変更: "F2",
    ファイルを開く: "Ctrl/⌘ P",
  };
  const commandKeywords: Record<string, string[]> = {
    実行: ["run", "render"],
    整形: ["format", "document"],
    サンプルを開く: ["examples"],
    定義へ移動: ["definition", "f12"],
    YAMLの対応箇所へ移動: ["source map", "yaml"],
    参照箇所を検索: ["references", "shift f12"],
    シンボル名を変更: ["rename", "f2"],
    共有: ["share"],
    ファイルを開く: ["quick open", "open file", "ctrl p"],
    ファイルを作成: ["new file", "create file"],
    新しいプロジェクト: ["new project"],
    出力を表示: ["output"],
    問題を表示: ["problems", "diagnostics"],
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
    setStaleYaml(latestYaml.current);
    setShowDiff(false);
    setReply((previous) =>
      previous ? { ...previous, ok: false, result: undefined, diagnostics: [] } : previous,
    );
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
      if (!applyingSample.current) setSample("custom");
      latestYaml.current = undefined;
      setStaleYaml(undefined);
      setPreviousYaml(undefined);
      setShowDiff(false);
      const requestedPath = project.activePath;
      const nextPath =
        requestedPath &&
        (requestedPath === "main.mcl" || project.files[requestedPath]?.encoding === "utf8")
          ? requestedPath
          : "main.mcl";
      replaceProjectState(project.source, project.files, nextPath);
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
      setReply(undefined);
      if (startupReady.current) scheduleLint(project.source, currentRevision);
    },
    [activateDraft, projectRef, replaceProjectState, saveDraftSnapshot, scheduleLint],
  );

  useEffect(() => {
    const createdClient = createPlaygroundClient();
    client.current = createdClient;

    let cancelled = false;
    void (async () => {
      let restored: StoredProject | undefined;
      let activeId = "";
      let restoredSample: string | undefined;
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
      try {
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
      } catch (cause) {
        if (!cancelled) setError(sharedProjectError(cause, false));
      }

      if (!window.location.hash.startsWith("#project=")) {
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
            restoredSample = example.slug;
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
        if (recoveredSharedDraft) await saveDraftSnapshot(activeId, projectRef.current);
        if (restoredSample) setSample(restoredSample);
      }
      startupReady.current = true;
      markDraftsLoaded();
      void trackWasmRequest(createdClient.warmUp())
        .then(() => {
          if (cancelled) return;
          setWasmReady(true);
          runAction.current();
        })
        .catch((cause: unknown) => {
          if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
        });
    })();

    return () => {
      cancelled = true;
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
    trackWasmRequest,
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
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    const dialog = commandPaletteDialog.current;
    if (!dialog) return;
    if (commandPaletteOpen && !dialog.open) dialog.showModal();
    else if (!commandPaletteOpen && dialog.open) dialog.close();
  }, [commandPaletteOpen]);

  useEffect(() => {
    const dialog = examplesDialog.current;
    if (!dialog) return;
    if (examplesOpen && !dialog.open) dialog.showModal();
    else if (!examplesOpen && dialog.open) dialog.close();
  }, [examplesOpen]);

  useEffect(() => {
    const dialog = quickOpenDialog.current;
    if (!dialog) return;
    if (quickOpen && !dialog.open) dialog.showModal();
    else if (!quickOpen && dialog.open) dialog.close();
  }, [quickOpen]);

  useEffect(() => {
    const dialog = fileActionDialog.current;
    if (!dialog) return;
    if (fileAction && !dialog.open) dialog.showModal();
    else if (!fileAction && dialog.open) dialog.close();
  }, [fileAction]);

  useEffect(() => {
    const dialog = symbolRenameDialog.current;
    if (!dialog) return;
    if (symbolRenameOpen && !dialog.open) dialog.showModal();
    else if (!symbolRenameOpen && dialog.open) dialog.close();
  }, [symbolRenameOpen]);

  useEffect(() => {
    const dialog = symbolReferencesDialog.current;
    if (!dialog) return;
    if (symbolReferencesOpen && !dialog.open) dialog.showModal();
    else if (!symbolReferencesOpen && dialog.open) dialog.close();
  }, [symbolReferencesOpen]);

  const onEditorReady = useCallback(
    (view: EditorView | undefined) => {
      editor.current = view;
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
      if (!applyingSample.current) setSample("custom");
      const currentRevision = ++revision.current;
      setDiagnostics([]);
      setStaleYaml(latestYaml.current);
      setShowDiff(false);
      setReply((previous) =>
        previous
          ? { ...previous, ok: false, result: undefined, error: undefined, diagnostics: [] }
          : previous,
      );
      setError(recoveryError ?? "");
      setBusy(false);
      if (startupReady.current) scheduleLint(projectRef.current.source, currentRevision);
      return true;
    },
    [activeDraftIdRef, projectRef, scheduleLint, setFileContent],
  );

  async function run(focusOutput = true) {
    if (!editor.current || !client.current || loadingProject || isRendering()) return;
    const currentRevision = ++revision.current;
    const request = runWasm(projectRef.current.source, currentRevision);
    if (!request) return;
    setBusy(true);
    setError("");
    setStaleYaml(latestYaml.current);
    setReply(undefined);
    setShowDiff(false);
    try {
      const result = await request;
      if (currentRevision !== revision.current) return;
      setDiagnostics(result.diagnostics ?? (result.error ? [result.error] : []));
      if (result.ok) {
        setShowProblems(false);
        if (focusOutput) setMobileView("output");
        setStaleYaml(undefined);
        const yaml = result.result?.yaml;
        if (yaml !== undefined) {
          setPreviousYaml(latestYaml.current);
          latestYaml.current = yaml;
          setShowDiff(false);
        }
        setReply(result);
      } else {
        setMobileView("problems");
        setShowProblems(true);
        setReply(result);
        if (result.error) setError(`${result.error.code}: ${result.error.message}`);
      }
    } catch (cause) {
      if (currentRevision === revision.current)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (currentRevision === revision.current) setBusy(false);
    }
  }

  runAction.current = () => void run(false);

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
      const result = await trackWasmRequest(
        client.current.format(view.state.doc.toString(), currentRevision),
      );
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
      applyingSample.current = true;
      setSample(selected);
      applyProject(
        { source: builtin, files: {} },
        { name: selected === "configMap" ? "ConfigMap" : "Deployment" },
      );
      applyingSample.current = false;
      setExamplesOpen(false);
      return;
    }
    const example = examples.find((entry) => entry.slug === selected);
    if (!example) return;

    setLoadingProject(true);
    applyingSample.current = true;
    try {
      const files = await loadExampleFiles(example);
      const { ["main.mcl"]: source, ...otherFiles } = files;
      setSample(selected);
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
      setSample("custom");
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      applyingSample.current = false;
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
    applyingSample.current = true;
    setSample("configMap");
    applyProject({ source: initialSource, files: {} }, { name: "プロジェクト" });
    applyingSample.current = false;
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
      const fragment = await encodeSharedProject({
        source: snapshot.source,
        files: snapshot.files,
        activePath: snapshot.activePath,
      });
      const shareURL = new URL(window.location.href);
      shareURL.hash = fragment.slice(1);
      await setDraftShare(draftId, fragment);
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
      await navigator.clipboard.writeText(shareURL.href);
      history.replaceState(null, "", fragment);
      setNotice("共有URLをコピーしました");
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
      const location = await trackWasmRequest(
        playground.definition(view.state.doc.toString(), path, position, languageServiceFiles()),
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
      const references = await trackWasmRequest(
        playground.references(source, path, position, languageServiceFiles()),
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
      const edits = await trackWasmRequest(
        playground.rename(source, path, position, newName, languageServiceFiles()),
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
      const applied = applyEdits(edits, sources);
      if (!applied.ok) {
        setSymbolRenameError(applied.error);
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
      setNotice("シンボル名を変更しました");
    } catch (cause) {
      setSymbolRenameError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  function openSymbolRename() {
    setSymbolRenameError("");
    setSymbolRenameInput("");
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
            <details className="playground-more playground-settings">
              <summary>設定</summary>
              <div className="playground-more-menu">
                <label className="playground-setting">
                  配色
                  <select
                    value={editorSettings.theme}
                    onChange={(event) => {
                      const theme = event.currentTarget.value as EditorSettings["theme"];
                      setEditorSettings((settings) => ({
                        ...settings,
                        theme,
                      }));
                    }}
                  >
                    <option value="system">システム</option>
                    <option value="light">ライト</option>
                    <option value="dark">ダーク</option>
                  </select>
                </label>
                <label className="playground-setting">
                  インデント幅
                  <select
                    value={editorSettings.tabSize}
                    onChange={(event) => {
                      const tabSize = Number(event.currentTarget.value) as 2 | 4;
                      setEditorSettings((settings) => ({
                        ...settings,
                        tabSize,
                      }));
                    }}
                  >
                    <option value={2}>2</option>
                    <option value={4}>4</option>
                  </select>
                </label>
                <label className="playground-setting">
                  文字サイズ
                  <input
                    type="range"
                    min={12}
                    max={20}
                    step={2}
                    value={editorSettings.fontSize}
                    aria-label="文字サイズ"
                    onChange={(event) => {
                      const fontSize = Number(
                        event.currentTarget.value,
                      ) as EditorSettings["fontSize"];
                      setEditorSettings((settings) => ({
                        ...settings,
                        fontSize,
                      }));
                    }}
                  />
                  <output>{editorSettings.fontSize}px</output>
                </label>
                <label className="playground-setting">
                  <input
                    type="checkbox"
                    checked={editorSettings.lineWrapping}
                    onChange={(event) => {
                      const lineWrapping = event.currentTarget.checked;
                      setEditorSettings((settings) => ({
                        ...settings,
                        lineWrapping,
                      }));
                    }}
                  />
                  折り返し
                </label>
                <label className="playground-setting">
                  <input
                    type="checkbox"
                    checked={editorSettings.lineNumbers}
                    onChange={(event) => {
                      const lineNumbers = event.currentTarget.checked;
                      setEditorSettings((settings) => ({
                        ...settings,
                        lineNumbers,
                      }));
                    }}
                  />
                  行番号
                </label>
                <label className="playground-setting">
                  <input
                    type="checkbox"
                    checked={editorSettings.vim}
                    onChange={(event) => {
                      const vim = event.currentTarget.checked;
                      setEditorSettings((settings) => ({
                        ...settings,
                        vim,
                      }));
                    }}
                  />
                  Vim
                </label>
              </div>
            </details>
          </div>
        </div>
      </header>
      <dialog
        ref={examplesDialog}
        className="playground-examples-dialog"
        aria-labelledby="playground-examples-title"
        onCancel={() => setExamplesOpen(false)}
      >
        <header className="playground-dialog-header">
          <h2 id="playground-examples-title">サンプル</h2>
          <button type="button" onClick={() => setExamplesOpen(false)} aria-label="閉じる">
            ×
          </button>
        </header>
        <div className="playground-examples-list">
          <section className="playground-example-category">
            <h3>基本</h3>
            <div className="playground-example-grid">
              <button type="button" onClick={() => void selectSample("configMap")}>
                <span>ConfigMap</span>
                <small>値を定義してManifestを生成</small>
              </button>
              <button type="button" onClick={() => void selectSample("deployment")}>
                <span>Deployment</span>
                <small>アプリケーションの構成を記述</small>
              </button>
            </div>
          </section>
          {[...new Set(examples.map((entry) => entry.category))].map((category) => (
            <section className="playground-example-category" key={category}>
              <h3>{category}</h3>
              <div className="playground-example-grid">
                {examples
                  .filter((entry) => entry.category === category)
                  .map((entry) => (
                    <button
                      type="button"
                      key={entry.slug}
                      aria-pressed={sample === entry.slug}
                      onClick={() => void selectSample(entry.slug)}
                    >
                      <span>{entry.title}</span>
                      <small>{entry.slug}</small>
                    </button>
                  ))}
              </div>
            </section>
          ))}
        </div>
      </dialog>
      {loadingProject && <p role="status">読み込み中</p>}
      {quickOpen && (
        <dialog
          ref={quickOpenDialog}
          className="playground-quick-open"
          aria-label="ファイルを開く"
          onCancel={() => setQuickOpen(false)}
        >
          <QuickAccessList
            label="ファイルへ移動"
            placeholder="ファイル名を入力"
            emptyMessage="一致するファイルはありません"
            items={quickOpenItems}
          />
        </dialog>
      )}
      {commandPaletteOpen && (
        <dialog
          ref={commandPaletteDialog}
          className="playground-quick-open"
          aria-label="コマンド"
          onCancel={() => setCommandPaletteOpen(false)}
        >
          <QuickAccessList
            label="コマンド"
            placeholder="コマンドを検索"
            emptyMessage="一致するコマンドはありません"
            items={commandItems}
          />
        </dialog>
      )}
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
      <Group className="playground-panels" orientation={orientation} data-mobile-view={mobileView}>
        <Panel className="playground-editor-panel" defaultSize="55" minSize="25">
          <div className="playground-editor-workspace">
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
            <MclEditor
              key={`${editorAttempt}:${projectGeneration}`}
              path={activePath}
              paths={projectPaths}
              source={activeSource}
              settings={editorSettings}
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
                  ? trackWasmRequest(
                      client.current.complete(
                        sourceForPath(path),
                        path,
                        position,
                        languageServiceFiles(),
                      ),
                    )
                  : Promise.resolve([])
              }
              onDefinition={(path, position) =>
                client.current
                  ? trackWasmRequest(
                      client.current.definition(
                        sourceForPath(path),
                        path,
                        position,
                        languageServiceFiles(),
                      ),
                    )
                  : Promise.resolve(null)
              }
              onHover={(path, position) =>
                client.current
                  ? trackWasmRequest(
                      client.current.hover(
                        sourceForPath(path),
                        path,
                        position,
                        languageServiceFiles(),
                      ),
                    )
                  : Promise.resolve(null)
              }
              onNavigate={navigateToDefinition}
              onNavigateToYaml={navigateToYaml}
              onFindReferences={() => void findSymbolReferences()}
              onRenameSymbol={openSymbolRename}
            />
          </div>
        </Panel>
        <Separator className="playground-resize-handle" aria-label="エディターと結果の配置を変更" />
        <Panel className="playground-output-panel" defaultSize="45" minSize="25">
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
                    !reply?.ok || previousYaml === undefined || previousYaml === reply.result?.yaml
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
                onClick={() =>
                  setOrientation((current) => (current === "vertical" ? "horizontal" : "vertical"))
                }
                aria-label={orientation === "vertical" ? "左右に並べる" : "上下に並べる"}
                title={orientation === "vertical" ? "左右に並べる" : "上下に並べる"}
              >
                {orientation === "vertical" ? "左右" : "上下"}
              </button>
            </div>
            <PlaygroundResult
              reply={reply}
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
            {showProblems && reply && diagnostics.length === 0 && (
              <p className="playground-no-problems">問題はありません</p>
            )}
          </div>
        </Panel>
      </Group>
      <footer className="playground-statusbar" aria-label="プロジェクトの状態">
        <span className={wasmReady ? "playground-status-ready" : "playground-status-loading"}>
          <span aria-hidden="true">●</span> {wasmReady ? "WASM" : "WASM読み込み中"}
        </span>
        <span>{diagnostics.length}件の問題</span>
        <span>{Object.keys(projectFiles).length + 1}ファイル</span>
        <span>{(projectSizeBytes / 1024 / 1024).toFixed(1)} MiB</span>
        <span className="playground-status-path">{activePath}</span>
      </footer>
      <dialog
        ref={fileActionDialog}
        className="playground-file-action"
        aria-labelledby="playground-file-action-title"
        onCancel={() => setFileAction(undefined)}
      >
        {fileAction?.kind === "delete" ? (
          <>
            <h2 id="playground-file-action-title">ファイルの削除</h2>
            <p>{fileAction.path}を削除しますか？</p>
            {fileActionError && <p role="alert">{fileActionError}</p>}
            <div className="playground-file-action-buttons">
              <button type="button" onClick={() => setFileAction(undefined)}>
                キャンセル
              </button>
              <button
                type="button"
                className="playground-file-action-danger"
                onClick={confirmDeleteFile}
              >
                削除
              </button>
            </div>
          </>
        ) : (
          <form onSubmit={submitFileAction}>
            <h2 id="playground-file-action-title">
              {fileAction?.kind === "rename" ? "ファイル名の変更" : "新規ファイル"}
            </h2>
            <label>
              <span>ファイルパス</span>
              <input
                autoFocus
                value={filePathInput}
                onChange={(event) => setFilePathInput(event.currentTarget.value)}
                placeholder="values.yaml"
                required
                maxLength={512}
              />
            </label>
            {fileActionError && <p role="alert">{fileActionError}</p>}
            <div className="playground-file-action-buttons">
              <button type="button" onClick={() => setFileAction(undefined)}>
                キャンセル
              </button>
              <button type="submit">{fileAction?.kind === "rename" ? "変更" : "作成"}</button>
            </div>
          </form>
        )}
      </dialog>
      <dialog
        ref={symbolRenameDialog}
        className="playground-file-action"
        aria-labelledby="playground-symbol-rename-title"
        onCancel={() => setSymbolRenameOpen(false)}
      >
        <form onSubmit={(event) => void renameSymbol(event)}>
          <h2 id="playground-symbol-rename-title">シンボル名の変更</h2>
          <label>
            <span>新しい名前</span>
            <input
              autoFocus
              value={symbolRenameInput}
              onChange={(event) => setSymbolRenameInput(event.currentTarget.value)}
              required
              maxLength={256}
            />
          </label>
          {symbolRenameError && <p role="alert">{symbolRenameError}</p>}
          <div className="playground-file-action-buttons">
            <button type="button" onClick={() => setSymbolRenameOpen(false)}>
              キャンセル
            </button>
            <button type="submit" disabled={busy || loadingProject}>
              変更
            </button>
          </div>
        </form>
      </dialog>
      <dialog
        ref={symbolReferencesDialog}
        className="playground-quick-open"
        aria-labelledby="playground-symbol-references-title"
        onCancel={() => setSymbolReferencesOpen(false)}
      >
        <label id="playground-symbol-references-title">
          <span>参照箇所</span>
        </label>
        {symbolReferencesError ? (
          <p role="alert">{symbolReferencesError}</p>
        ) : symbolReferences.length > 0 ? (
          <ul className="playground-reference-list">
            {symbolReferences.map((reference, index) => {
              const { line, character } = reference.range.start;
              const sourceLine = sourceForPath(reference.path).split(/\r?\n/)[line] ?? "";
              return (
                <li key={`${reference.path}:${line}:${character}:${index}`}>
                  <button
                    type="button"
                    onClick={() => {
                      navigateToDefinition(reference);
                      setSymbolReferencesOpen(false);
                    }}
                  >
                    <span>
                      {reference.path}:{line + 1}:{character + 1}
                    </span>
                    {sourceLine && <code>{sourceLine.trim()}</code>}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p>参照が見つかりません</p>
        )}
        <div className="playground-file-action-buttons">
          <button type="button" onClick={() => setSymbolReferencesOpen(false)}>
            閉じる
          </button>
        </div>
      </dialog>
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
