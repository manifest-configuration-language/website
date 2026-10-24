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
import type {
  PlaygroundDefinitionLocation,
  PlaygroundDiagnostic,
  PlaygroundReply,
  ProjectFile,
} from "./types";
import { writeProjectArchive } from "./projectZip";
import exampleCatalog from "./generatedExamples.json";
import { usePlaygroundProject } from "./usePlaygroundProject";
import { usePlaygroundRuntime } from "./usePlaygroundRuntime";

const storageKey = "mcl-playground-project-v1";
const activeDraftKey = "mcl-playground-active-draft-v1";
const draftIndexKey = "mcl-playground-drafts-v1";
const draftKeyPrefix = "mcl-playground-draft-v1:";
const draftShareKeyPrefix = "mcl-playground-draft-share-v1:";
const editorSettingsKey = "mcl-playground-editor-settings-v1";
const defaultEditorSettings: EditorSettings = {
  tabSize: 2,
  fontSize: 14,
  lineWrapping: false,
  lineNumbers: true,
  vim: false,
};
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
type ExampleSpec = { category: string; title: string; slug: string; asset: string };
type DraftMetadata = { id: string; name: string; updatedAt: number };

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

function isDraftMetadataList(value: unknown): value is DraftMetadata[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        item !== null &&
        typeof item === "object" &&
        typeof (item as DraftMetadata).id === "string" &&
        typeof (item as DraftMetadata).name === "string" &&
        typeof (item as DraftMetadata).updatedAt === "number",
    )
  );
}

function draftDataKey(id: string) {
  return `${draftKeyPrefix}${id}`;
}

function draftShareKey(id: string) {
  return `${draftShareKeyPrefix}${id}`;
}

function clearSharedFragment() {
  if (!window.location.hash.startsWith("#project=")) return;
  history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
}

function isStoredProject(value: unknown): value is StoredProject {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.source !== "string" ||
    !candidate.files ||
    typeof candidate.files !== "object" ||
    Array.isArray(candidate.files) ||
    (candidate.activePath !== undefined && typeof candidate.activePath !== "string")
  )
    return false;
  return Object.values(candidate.files).every((file) => {
    if (!file || typeof file !== "object") return false;
    const candidateFile = file as Record<string, unknown>;
    return (
      (candidateFile.encoding === "utf8" && typeof candidateFile.content === "string") ||
      (candidateFile.encoding === "binary" && candidateFile.bytes instanceof Uint8Array)
    );
  });
}

function isEditorSettings(
  value: unknown,
): value is Omit<EditorSettings, "fontSize"> & { fontSize?: EditorSettings["fontSize"] } {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    (candidate.tabSize === 2 || candidate.tabSize === 4) &&
    (candidate.fontSize === undefined ||
      [12, 14, 16, 18, 20].includes(candidate.fontSize as number)) &&
    typeof candidate.lineWrapping === "boolean" &&
    typeof candidate.lineNumbers === "boolean" &&
    typeof candidate.vim === "boolean"
  );
}

function projectSize(files: Record<string, ProjectFile>): number {
  const encoder = new TextEncoder();
  return Object.values(files).reduce(
    (total, file) =>
      total +
      (file.encoding === "utf8" ? encoder.encode(file.content).byteLength : file.bytes.byteLength),
    0,
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
  const client = useRef<ReturnType<typeof createPlaygroundClient> | undefined>(undefined);
  const revision = useRef(0);
  const latestYaml = useRef<string | undefined>(undefined);
  const pendingNavigation = useRef<PlaygroundDiagnostic | undefined>(undefined);
  const quickOpenDialog = useRef<HTMLDialogElement>(null);
  const startupReady = useRef(false);
  const activeDraftIdRef = useRef("");
  const applyingSample = useRef(false);
  const [reply, setReply] = useState<PlaygroundReply>();
  const [staleYaml, setStaleYaml] = useState<string>();
  const [previousYaml, setPreviousYaml] = useState<string>();
  const [showDiff, setShowDiff] = useState(false);
  const [showProblems, setShowProblems] = useState(false);
  const [editorSettings, setEditorSettings] = useState<EditorSettings>(defaultEditorSettings);
  const [editorSettingsLoaded, setEditorSettingsLoaded] = useState(false);
  const [diagnostics, setDiagnostics] = useState<PlaygroundDiagnostic[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editorError, setEditorError] = useState("");
  const [editorAttempt, setEditorAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [loadingProject, setLoadingProject] = useState(false);
  const projectFiles = project.files;
  const projectSizeBytes =
    projectSize(project.files) + new TextEncoder().encode(project.source).byteLength;
  const activePath = project.activePath;
  const [projectGeneration, setProjectGeneration] = useState(0);
  const [wasmReady, setWasmReady] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"saving" | "saved" | "failed">("saved");
  const [activeDraftId, setActiveDraftId] = useState("");
  const [drafts, setDrafts] = useState<DraftMetadata[]>([]);
  const [draftsLoaded, setDraftsLoaded] = useState(false);
  const [orientation, setOrientation] = useState<"horizontal" | "vertical">("horizontal");
  const [sample, setSample] = useState("configMap");
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickQuery, setQuickQuery] = useState("");
  const [recentPaths, setRecentPaths] = useState(["main.mcl"]);
  const [quickSelection, setQuickSelection] = useState(0);
  const draftsRef = useRef<DraftMetadata[]>([]);

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

  const updateDraftMetadata = useCallback((id: string, name?: string) => {
    const previous = draftsRef.current.find((draft) => draft.id === id);
    const nextDraft = {
      id,
      name: name ?? previous?.name ?? "作業",
      updatedAt: Date.now(),
    };
    const next = [nextDraft, ...draftsRef.current.filter((draft) => draft.id !== id)];
    draftsRef.current = next;
    setDrafts(next);
    void set(draftIndexKey, next).catch((cause: unknown) => {
      setSaveStatus("failed");
      setError(cause instanceof Error ? cause.message : String(cause));
    });
  }, []);

  const saveDraftSnapshot = useCallback(
    async (id: string, value: StoredProject) => {
      if (!id) return;
      await set(draftDataKey(id), value);
      updateDraftMetadata(id);
    },
    [updateDraftMetadata],
  );

  const activateDraft = useCallback(
    (id: string, name?: string, shareFragment?: string) => {
      activeDraftIdRef.current = id;
      setActiveDraftId(id);
      void set(activeDraftKey, id).catch((cause: unknown) => {
        setSaveStatus("failed");
        setError(cause instanceof Error ? cause.message : String(cause));
      });
      if (shareFragment !== undefined)
        void set(draftShareKey(id), shareFragment).catch((cause: unknown) => {
          setSaveStatus("failed");
          setError(cause instanceof Error ? cause.message : String(cause));
        });
      updateDraftMetadata(id, name);
    },
    [updateDraftMetadata],
  );

  const editablePaths = [
    "main.mcl",
    ...Object.entries(projectFiles)
      .filter(([, file]) => file.encoding === "utf8")
      .map(([path]) => path)
      .sort(),
  ];
  const mclPaths = editablePaths.filter((path) => path.endsWith(".mcl"));
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
    })
    .filter((path) => path.toLowerCase().includes(quickQuery.trim().toLowerCase()));
  const activeSource =
    activePath === "main.mcl"
      ? project.source
      : projectFiles[activePath]?.encoding === "utf8"
        ? projectFiles[activePath].content
        : "";

  function finishProjectMutation() {
    const currentRevision = ++revision.current;
    setDiagnostics([]);
    setStaleYaml(latestYaml.current);
    setShowDiff(false);
    setReply((previous) =>
      previous ? { ...previous, ok: false, result: undefined, diagnostics: [] } : previous,
    );
    setBusy(false);
    if (startupReady.current) scheduleLint(projectRef.current.source, currentRevision);
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
        void saveDraftSnapshot(activeDraftIdRef.current, projectRef.current).catch(
          (cause: unknown) => {
            setSaveStatus("failed");
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
          setSaveStatus("failed");
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
        const savedIndex: unknown = await get(draftIndexKey);
        const savedDrafts = isDraftMetadataList(savedIndex) ? savedIndex : [];
        draftsRef.current = savedDrafts;
        setDrafts(savedDrafts);

        const savedActiveId: unknown = await get(activeDraftKey);
        if (typeof savedActiveId === "string" && /^[0-9a-f-]{36}$/i.test(savedActiveId)) {
          const saved: unknown = await get(draftDataKey(savedActiveId));
          if (isStoredProject(saved)) {
            restored = saved;
            activeId = savedActiveId;
          }
        }
        if (!restored) {
          const legacy: unknown = await get(storageKey);
          if (isStoredProject(legacy)) {
            restored = legacy;
            activeId = crypto.randomUUID();
            await set(draftDataKey(activeId), legacy);
            activateDraft(activeId, "復元した作業");
          }
        }
        if (!activeId) {
          activeId = crypto.randomUUID();
        } else {
          activeDraftIdRef.current = activeId;
          setActiveDraftId(activeId);
          void set(activeDraftKey, activeId);
          if (!draftsRef.current.some((draft) => draft.id === activeId))
            updateDraftMetadata(activeId, "作業");
        }
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      }
      if (!activeId) {
        activeId = crypto.randomUUID();
        activateDraft(activeId, "作業");
      }

      try {
        const shared = await decodeSharedProject(window.location.hash);
        if (shared) {
          const savedShare: unknown = await get(draftShareKey(activeId));
          if (!(restored && savedShare === window.location.hash)) {
            restored = shared;
            activeId = crypto.randomUUID();
            activateDraft(activeId, "共有プロジェクト", window.location.hash);
          }
        }
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
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
            url.searchParams.delete("example");
            history.replaceState(null, "", url);
          } catch (cause) {
            if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
          }
        }
      }
      if (cancelled) return;
      if (!draftsRef.current.some((draft) => draft.id === activeId))
        activateDraft(activeId, "作業");
      if (restored) {
        applyProject(restored, { newDraft: false });
        if (restoredSample) setSample(restoredSample);
      }
      startupReady.current = true;
      setDraftsLoaded(true);
      const currentRevision = ++revision.current;
      void trackWasmRequest(createdClient.warmUp())
        .then(() => {
          if (!cancelled) setWasmReady(true);
        })
        .catch((cause: unknown) => {
          if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
        });
      scheduleLint(projectRef.current.source, currentRevision);
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
    projectRef,
    scheduleLint,
    trackWasmRequest,
    updateDraftMetadata,
  ]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 48rem)");
    const update = () => setOrientation(media.matches ? "vertical" : "horizontal");
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "p") {
        event.preventDefault();
        setQuickQuery("");
        setQuickSelection(0);
        setQuickOpen(true);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    setQuickSelection(0);
  }, [quickQuery]);

  useEffect(() => {
    const dialog = quickOpenDialog.current;
    if (!dialog) return;
    if (quickOpen && !dialog.open) dialog.showModal();
    else if (!quickOpen && dialog.open) dialog.close();
  }, [quickOpen]);

  useEffect(() => {
    if (!draftsLoaded || !activeDraftId) return;
    setSaveStatus("saving");
    const timer = setTimeout(() => {
      const savedProject = {
        source: project.source,
        files: project.files,
        activePath: project.activePath,
      };
      void saveDraftSnapshot(activeDraftId, savedProject)
        .then(() => setSaveStatus("saved"))
        .catch((cause: unknown) => {
          setSaveStatus("failed");
          setError(cause instanceof Error ? cause.message : String(cause));
        });
    }, 300);
    return () => clearTimeout(timer);
  }, [activeDraftId, draftsLoaded, project, saveDraftSnapshot]);

  useEffect(() => {
    let cancelled = false;
    void get(editorSettingsKey)
      .then((saved: unknown) => {
        if (!cancelled && isEditorSettings(saved))
          setEditorSettings({
            ...saved,
            fontSize: saved.fontSize ?? defaultEditorSettings.fontSize,
          });
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (!cancelled) setEditorSettingsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!editorSettingsLoaded) return;
    void set(editorSettingsKey, editorSettings).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : String(cause));
    });
  }, [editorSettings, editorSettingsLoaded]);

  const onEditorReady = useCallback(
    (view: EditorView | undefined) => {
      editor.current = view;
      if (
        view &&
        projectRef.current.activePath === "main.mcl" &&
        projectRef.current.source !== view.state.doc.toString()
      ) {
        setFileContent("main.mcl", view.state.doc.toString());
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
      setFileContent(path, source);
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
      setError("");
      setBusy(false);
      if (startupReady.current) scheduleLint(projectRef.current.source, currentRevision);
    },
    [projectRef, scheduleLint, setFileContent],
  );

  async function run() {
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
        setStaleYaml(undefined);
        const yaml = result.result?.yaml;
        if (yaml !== undefined) {
          setPreviousYaml(latestYaml.current);
          latestYaml.current = yaml;
          setShowDiff(false);
        }
        setReply(result);
      } else {
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
    }
  }

  async function openDraft(id: string) {
    if (id === activeDraftIdRef.current) return;
    try {
      await saveDraftSnapshot(activeDraftIdRef.current, projectRef.current);
      const saved: unknown = await get(draftDataKey(id));
      if (!isStoredProject(saved)) throw new Error("作業を読み込めません");
      activeDraftIdRef.current = id;
      setActiveDraftId(id);
      await set(activeDraftKey, id);
      clearSharedFragment();
      applyProject(saved, { newDraft: false });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  function createDraft() {
    applyingSample.current = true;
    setSample("configMap");
    applyProject({ source: initialSource, files: {} }, { name: "作業" });
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
    try {
      const fragment = await encodeSharedProject({
        source: projectRef.current.source,
        files: projectRef.current.files,
        activePath: projectRef.current.activePath,
      });
      const shareURL = new URL(window.location.href);
      shareURL.hash = fragment.slice(1);
      await saveDraftSnapshot(activeDraftIdRef.current, projectRef.current);
      await set(draftShareKey(activeDraftIdRef.current), fragment);
      await navigator.clipboard.writeText(shareURL.href);
      history.replaceState(null, "", fragment);
      setNotice("共有URLをコピーしました");
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
    revision.current += 1;
    setBusy(false);
    selectProjectFile(path);
    setRecentPaths((previous) => [path, ...previous.filter((entry) => entry !== path)]);
  }

  function createFile() {
    const path = window.prompt("作成するファイルのパス", "values.yaml")?.trim();
    if (!path) return;
    const result = createProjectFile(path);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    finishProjectMutation();
    setRecentPaths((previous) => [path, ...previous.filter((entry) => entry !== path)]);
  }

  function renameFile(path: string) {
    const nextPath = window.prompt("新しいファイルパス", path)?.trim();
    if (!nextPath || nextPath === path) return;
    const result = renameProjectFile(path, nextPath);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    finishProjectMutation();
    setRecentPaths((previous) => previous.map((entry) => (entry === path ? nextPath : entry)));
  }

  function deleteFile(path: string) {
    if (!window.confirm(`${path}を削除しますか？`)) return;
    const result = deleteProjectFile(path);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    finishProjectMutation();
    setRecentPaths((previous) => previous.filter((entry) => entry !== path));
  }

  return (
    <section className="playground" aria-label="MCLプレイグラウンド" aria-busy={loadingProject}>
      <header className="playground-header">
        <div className="playground-brand">
          <a href="/">MCL</a>
          <span>Playground</span>
          <span className="playground-runtime" role="status">
            {wasmReady ? "WASM準備完了" : "WASM準備中"}
          </span>
          <span className="playground-save-status" role="status">
            {saveStatus === "saved" ? "保存済み" : saveStatus === "saving" ? "保存中" : "保存失敗"}
          </span>
        </div>
        <div className="playground-toolbar">
          {busy || renderPending ? (
            <button type="button" onClick={cancel}>
              中断
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={run}
                disabled={!draftsLoaded || loadingProject || Boolean(editorError)}
              >
                実行
              </button>
              <button
                type="button"
                onClick={formatSource}
                disabled={
                  !draftsLoaded ||
                  loadingProject ||
                  Boolean(editorError) ||
                  !activePath.endsWith(".mcl")
                }
              >
                整形
              </button>
            </>
          )}
          <label className="playground-sample">
            <select
              aria-label="サンプル"
              value={sample}
              disabled={!draftsLoaded || busy || loadingProject}
              onChange={(event) => void selectSample(event.currentTarget.value)}
            >
              <option value="custom" disabled>
                カスタム
              </option>
              <option value="configMap">ConfigMap</option>
              <option value="deployment">Deployment</option>
              {[...new Set(examples.map((entry) => entry.category))].map((category) => (
                <optgroup key={category} label={category}>
                  {examples
                    .filter((entry) => entry.category === category)
                    .map((entry) => (
                      <option key={entry.slug} value={entry.slug}>
                        {entry.title}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </label>
          <label className="playground-sample">
            <select
              aria-label="ローカル作業"
              value={activeDraftId}
              disabled={!draftsLoaded || busy || loadingProject}
              onChange={(event) => void openDraft(event.currentTarget.value)}
            >
              {drafts.map((draft) => (
                <option key={draft.id} value={draft.id}>
                  {draft.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={createDraft}
            disabled={!draftsLoaded || busy || loadingProject}
          >
            新規作業
          </button>
          <button
            type="button"
            onClick={shareProject}
            disabled={!draftsLoaded || busy || loadingProject}
          >
            共有
          </button>
          <details className="playground-more">
            <summary>ファイル・設定</summary>
            <div className="playground-more-menu">
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
              <a href="/playground/capabilities">対応機能</a>
              <label className="playground-setting">
                Tab幅
                <select
                  value={editorSettings.tabSize}
                  onChange={(event) =>
                    setEditorSettings((settings) => ({
                      ...settings,
                      tabSize: Number(event.currentTarget.value) as 2 | 4,
                    }))
                  }
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
                  onChange={(event) =>
                    setEditorSettings((settings) => ({
                      ...settings,
                      fontSize: Number(event.currentTarget.value) as EditorSettings["fontSize"],
                    }))
                  }
                />
                <output>{editorSettings.fontSize}px</output>
              </label>
              <label className="playground-setting">
                <input
                  type="checkbox"
                  checked={editorSettings.lineWrapping}
                  onChange={(event) =>
                    setEditorSettings((settings) => ({
                      ...settings,
                      lineWrapping: event.currentTarget.checked,
                    }))
                  }
                />
                折り返し
              </label>
              <label className="playground-setting">
                <input
                  type="checkbox"
                  checked={editorSettings.lineNumbers}
                  onChange={(event) =>
                    setEditorSettings((settings) => ({
                      ...settings,
                      lineNumbers: event.currentTarget.checked,
                    }))
                  }
                />
                行番号
              </label>
              <label className="playground-setting">
                <input
                  type="checkbox"
                  checked={editorSettings.vim}
                  onChange={(event) =>
                    setEditorSettings((settings) => ({
                      ...settings,
                      vim: event.currentTarget.checked,
                    }))
                  }
                />
                Vim
              </label>
            </div>
          </details>
        </div>
      </header>
      {loadingProject && <p role="status">読み込み中</p>}
      {quickOpen && (
        <dialog
          ref={quickOpenDialog}
          className="playground-quick-open"
          aria-label="ファイルを開く"
          onCancel={() => setQuickOpen(false)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              setQuickOpen(false);
            }
            if (event.key === "ArrowDown" && quickPaths.length > 0) {
              event.preventDefault();
              setQuickSelection((index) => (index + 1) % quickPaths.length);
            }
            if (event.key === "ArrowUp" && quickPaths.length > 0) {
              event.preventDefault();
              setQuickSelection((index) => (index - 1 + quickPaths.length) % quickPaths.length);
            }
            if (event.key === "Enter" && quickPaths[quickSelection]) {
              event.preventDefault();
              selectFile(quickPaths[quickSelection]);
              setQuickOpen(false);
            }
          }}
        >
          <label>
            <span>ファイルへ移動</span>
            <input
              autoFocus
              value={quickQuery}
              onChange={(event) => setQuickQuery(event.currentTarget.value)}
              placeholder="ファイル名を入力"
            />
          </label>
          <ul>
            {quickPaths.map((path, index) => (
              <li key={path}>
                <button
                  type="button"
                  aria-current={index === quickSelection ? "true" : undefined}
                  onMouseEnter={() => setQuickSelection(index)}
                  onClick={() => {
                    selectFile(path);
                    setQuickOpen(false);
                  }}
                >
                  {path}
                </button>
              </li>
            ))}
          </ul>
          {quickPaths.length === 0 && <p>一致するファイルはありません</p>}
        </dialog>
      )}
      <Group className="playground-panels" orientation={orientation}>
        <Panel defaultSize={55} minSize={25}>
          <ProjectTabs
            paths={projectPaths}
            files={projectFiles}
            activePath={activePath}
            onSelect={selectFile}
            onCreate={createFile}
            onRename={renameFile}
            onDelete={deleteFile}
            disabled={!draftsLoaded || busy || loadingProject}
          />
          <MclEditor
            key={`${editorAttempt}:${projectGeneration}`}
            path={activePath}
            paths={projectPaths}
            source={activeSource}
            settings={editorSettings}
            onReady={onEditorReady}
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
          />
        </Panel>
        <Separator className="playground-resize-handle" aria-label="エディターと結果の幅を変更" />
        <Panel defaultSize={45} minSize={25}>
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
                  Problems{diagnostics.length > 0 ? ` ${diagnostics.length}` : ""}
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
                  Diff
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
            </div>
            <PlaygroundResult
              reply={reply}
              navigablePaths={editablePaths}
              staleYaml={staleYaml}
              previousYaml={previousYaml}
              fontSize={editorSettings.fontSize}
              showDiff={showDiff}
              showProblems={showProblems}
              onDiagnostic={goToDiagnostic}
            />
          </div>
        </Panel>
      </Group>
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
