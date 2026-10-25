import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EditorView } from "@codemirror/view";
import type { EditorState } from "@codemirror/state";
import { Button, I18nProvider } from "react-aria-components";
import { useTranslation } from "react-i18next";
import { playgroundLocale } from "./playgroundI18n";
import { initialSource, type ApplyWorkspaceEdits } from "./MclEditor";
import { projectSnapshotError, projectSnapshotErrorMessage } from "./projectValidation.js";
import { usePlaygroundBootstrap } from "./usePlaygroundBootstrap";
import { usePlaygroundClient } from "./usePlaygroundClient";
import {
  clearShareReferenceFromURL,
  usePlaygroundProjectActions,
} from "./usePlaygroundProjectActions";
import type { ExampleCatalogEntry } from "./usePlaygroundProjectActions";
import type { SourceMapLocationCandidate } from "./PlaygroundResult";
import { PlaygroundEditorDialogs } from "./PlaygroundEditorDialogs";
import type { PlaygroundClient, PlaygroundDiagnostic, ProjectFile } from "./types";
import exampleCatalog from "./generatedExamples.json";
import { usePlaygroundProject } from "./usePlaygroundProject";
import { usePlaygroundExecution } from "./usePlaygroundExecution";
import { renamePreviewEntries, usePlaygroundLanguageActions } from "./usePlaygroundLanguageActions";
import { PlaygroundQuickAccessDialogs } from "./PlaygroundQuickAccessDialogs";
import { PlaygroundShareDialog } from "./PlaygroundShareDialog";
import { DraftConflictDialog } from "./DraftConflictDialog";
import { DeleteProjectDialog } from "./DeleteProjectDialog";
import { WorkspaceHeader } from "./WorkspaceHeader";
import { WorkspaceLayout } from "./WorkspaceLayout";
import { SourceMapCandidateDialog } from "./SourceMapCandidateDialog";
import { usePlaygroundSharing } from "./usePlaygroundSharing";
import { usePlaygroundLayout } from "./usePlaygroundLayout";
import { usePlaygroundKeyboardShortcuts } from "./usePlaygroundKeyboardShortcuts";
import { usePlaygroundFileActions } from "./usePlaygroundFileActions";
import { createSourcePositionStore } from "./sourcePositionStore";
import "./symbolRenamePreview.css";
import { DraftConflictError, usePlaygroundPersistence } from "./usePlaygroundPersistence";
import type { StoredProject } from "./usePlaygroundPersistence";
import { usePlaygroundQuickAccess } from "./usePlaygroundQuickAccess";

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

type ExampleLocale = "en" | "ja";

function sharedProjectError(cause: unknown, tooLargeMessage: string): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  if (message === "Shared project is too large") return tooLargeMessage;
  return message;
}

export default function Playground() {
  const { t, i18n } = useTranslation();
  const exampleLocale: ExampleLocale = i18n.resolvedLanguage?.startsWith("en") ? "en" : "ja";
  const examples = useMemo(
    () =>
      (exampleCatalog as unknown as ExampleCatalogEntry[]).map((example) => ({
        ...example,
        category: example.category[exampleLocale],
        title: example.title[exampleLocale],
        description: example.description[exampleLocale],
        difficulty: example.difficulty[exampleLocale],
      })),
    [exampleLocale],
  );
  const client = useRef<PlaygroundClient | undefined>(undefined);
  const renameFileImports = useCallback(
    (source: string, files: Record<string, ProjectFile>, oldPath: string, newPath: string) => {
      const activeClient = client.current;
      if (!activeClient) return Promise.reject(new Error(t("wasmInitializing")));
      return activeClient.renameFileImports(source, files, oldPath, newPath);
    },
    [t],
  );
  const {
    projectRef,
    subscribe: subscribeToProject,
    replace: replaceProjectState,
    setFileContent,
    select: selectProjectFile,
    createFile: createProjectFile,
    renameFile: renameProjectFile,
    deleteFile: deleteProjectFile,
  } = usePlaygroundProject(initialSource, renameFileImports);
  const project = projectRef.current;
  const editor = useRef<EditorView | undefined>(undefined);
  const mclEditorStates = useRef(new Map<string, EditorState>());
  const textEditorStates = useRef(new Map<string, EditorState>());
  const workspaceEditApplier = useRef<ApplyWorkspaceEdits | undefined>(undefined);
  const pendingNavigation = useRef<PlaygroundDiagnostic | undefined>(undefined);
  const startupReady = useRef(false);
  const {
    applyWorkspacePreference,
    defaultPanelLayout,
    openPaths,
    orientation,
    outputCollapsed,
    outputPanel,
    panelGroup,
    savePanelLayout,
    setOpenPaths,
    setShowDiff,
    setShowProblems,
    setShowResources,
    showDiff,
    showProblems,
    showResources,
    toggleOrientation,
    toggleOutputPanel,
    workspace,
  } = usePlaygroundLayout();
  const [targetOutputPosition, setTargetOutputPosition] = useState<
    { line: number; character: number; requestId: number } | undefined
  >();
  const sourcePositionStore = useRef(createSourcePositionStore()).current;
  const [sourceMapCandidates, setSourceMapCandidates] = useState<SourceMapLocationCandidate[]>([]);
  const [diagnostics, setDiagnostics] = useState<PlaygroundDiagnostic[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pendingInitialImport, setPendingInitialImport] = useState<
    { id: string; name: string } | undefined
  >();
  const [editorError, setEditorError] = useState("");
  const [editorAttempt, setEditorAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [loadingProject, setLoadingProject] = useState(false);
  const projectFiles = project.files;
  const projectSizeBytes = project.totalBytes;
  const activePath = project.activePath;
  const [projectGeneration, setProjectGeneration] = useState(0);
  const [examplesOpen, setExamplesOpen] = useState(false);
  const [deleteProjectOpen, setDeleteProjectOpen] = useState(false);
  const [explorerOpen, setExplorerOpen] = useState(false);
  const [recentPaths, setRecentPaths] = useState(["main.mcl"]);
  const [mobileView, setMobileView] = useState<"editor" | "output" | "problems">("editor");
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
    markDraftsLoaded,
  } = usePlaygroundPersistence(projectRef, subscribeToProject, reportPersistenceError);
  useEffect(() => {
    if (pendingInitialImport?.id === activeDraftId) setPendingInitialImport(undefined);
  }, [activeDraftId, pendingInitialImport]);
  const activeDraftName =
    drafts.find((draft) => draft.id === activeDraftId)?.name ?? t("defaultProjectName");
  const draftConflict = conflictedDraftIds.includes(activeDraftId);
  const execution = usePlaygroundExecution({
    client,
    editor,
    project: projectRef,
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
  });
  const {
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
  } = execution;
  const handleShareError = useCallback(
    (cause: unknown) => setError(sharedProjectError(cause, t("sharedProjectTooLarge"))),
    [t],
  );
  const {
    shareDialogOpen,
    sharing,
    shareURL,
    shareError,
    openShareDialog,
    closeShareDialog,
    shareProject,
  } = usePlaygroundSharing({
    activeDraftIdRef,
    projectRef,
    saveDraftSnapshot,
    onNotice: setNotice,
    onError: handleShareError,
  });

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
    (path: string, line: number, character: number) =>
      sourcePositionStore.set({ path, line, character }),
    [sourcePositionStore],
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
  const activeSource =
    activePath === "main.mcl"
      ? project.source
      : projectFiles[activePath]?.encoding === "utf8"
        ? projectFiles[activePath].content
        : "";

  async function finishProjectMutation() {
    notifySourceChanged();
    clearShareReferenceFromURL();
  }

  const {
    fileAction,
    fileActionError,
    filePathInput,
    setFilePathInput,
    requestCreateFile,
    requestRenameFile,
    requestDeleteFile,
    submitFileAction,
    confirmDeleteFile,
    closeFileAction,
  } = usePlaygroundFileActions({
    createFile: createProjectFile,
    renameFile: renameProjectFile,
    deleteFile: deleteProjectFile,
    finishProjectMutation,
    setOpenPaths,
    setRecentPaths,
    setError,
  });

  function languageServiceFiles(): Record<string, ProjectFile> {
    const files = Object.assign(Object.create(null), projectRef.current.files) as Record<
      string,
      ProjectFile
    >;
    files["main.mcl"] = { encoding: "utf8", content: projectRef.current.source };
    return files;
  }

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
        setError(projectSnapshotErrorMessage(validationError, t));
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
        activateDraft(crypto.randomUUID(), options.name ?? t("importedProjectName"));
      }
      notifyProjectReplaced();
      applyWorkspacePreference(project.files, nextPath, options.newDraft !== false);
      void saveDraftSnapshot(activeDraftIdRef.current, projectRef.current).catch(
        (cause: unknown) => {
          if (cause instanceof DraftConflictError) return;
          setError(cause instanceof Error ? cause.message : String(cause));
        },
      );
      setProjectGeneration((value) => value + 1);
      setError("");
      return true;
    },
    [
      activateDraft,
      applyWorkspacePreference,
      notifyProjectReplaced,
      projectRef,
      replaceProjectState,
      saveDraftSnapshot,
      t,
    ],
  );

  const {
    confirmDeleteCurrentDraft,
    createDraft,
    deleteCurrentDraft,
    duplicateDraft,
    exportProject,
    loadProject,
    openDraft,
    reloadConflictedDraft,
    selectSample,
  } = usePlaygroundProjectActions({
    activeDraftName,
    applyProject,
    client,
    examples,
    initialSource,
    persistence: {
      activeDraftId,
      activeDraftIdRef,
      activateDraft,
      clearDraftConflict,
      deleteDraft,
      draftsRef,
      loadDraft,
      saveDraftSnapshot,
      setActiveDraft,
    },
    projectRef,
    downloadBlob,
    setDeleteProjectOpen,
    setError,
    setExamplesOpen,
    setLoadingProject,
    setNotice,
  });
  const quickAccess = usePlaygroundQuickAccess({
    t,
    examples,
    paths: projectPaths,
    files: projectFiles,
    recentPaths,
    sourceForPath,
    selectFile,
    selectSample,
    symbolReferences,
    navigateToDefinition,
    closeSymbolReferences,
    setShowProblems,
    setShowDiff,
    openExamples: () => setExamplesOpen(true),
    commandActions: {
      editor,
      activePath,
      hasSourceMap: Boolean(currentSourceMap),
      shortcuts: editorSettings.shortcuts,
      run: () => void run(),
      format: () => void formatSource(),
      toggleExplorer: () => setExplorerOpen((value) => !value),
      goToDefinition: () => void goToDefinitionAtCursor(),
      goToYaml: navigateToYaml,
      findReferences: openSymbolReferences,
      renameSymbol: openSymbolRename,
      share: openShareDialog,
      createFile: requestCreateFile,
      newProject: createDraft,
      showOutput: () => setMobileView("output"),
      showProblems: () => {
        setMobileView("problems");
        setShowProblems(true);
        setShowDiff(false);
      },
    },
  });
  const {
    commandItems,
    commandPaletteOpen,
    exampleItems,
    quickOpen,
    quickOpenItems,
    setCommandPaletteOpen,
    setQuickOpen,
    symbolReferenceItems,
  } = quickAccess;

  const { runInitialProjectIfReady } = usePlaygroundClient({
    client,
    startupReady,
    runAction,
    setWasmStatus,
    setError,
  });

  usePlaygroundBootstrap({
    editor,
    startupReady,
    runInitialProjectIfReady,
    project: projectRef,
    activeDraftIdRef,
    draftsRef,
    examples,
    t,
    loadDraftIndex,
    loadActiveDraftId,
    loadDraft,
    setActiveDraft,
    activateDraft,
    updateDraftMetadata,
    markDraftsLoaded,
    applyProject,
    applyWorkspacePreference,
    saveDraftSnapshot,
    setPendingInitialImport,
    setError,
  });

  useEffect(() => {
    const root = document.querySelector<HTMLElement>(".playground-app");
    if (!root) return;
    if (editorSettings.theme === "system") root.removeAttribute("data-playground-theme");
    else root.dataset.playgroundTheme = editorSettings.theme;
    return () => root.removeAttribute("data-playground-theme");
  }, [editorSettings.theme]);

  useEffect(() => {
    if (!activePath.endsWith(".mcl")) sourcePositionStore.set(undefined);
    setSourceMapCandidates([]);
  }, [activePath, sourcePositionStore]);

  usePlaygroundKeyboardShortcuts({
    shortcuts: editorSettings.shortcuts,
    setCommandPaletteOpen,
    setQuickOpen,
    setExplorerOpen,
    setMobileView,
    setShowProblems,
    setShowDiff,
  });

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
          notifyInitialContentChanged();
        }
      }
      const diagnostic = pendingNavigation.current;
      if (view && diagnostic && (diagnostic.path ?? "main.mcl") === projectRef.current.activePath) {
        pendingNavigation.current = undefined;
        goToEditorPosition(diagnostic);
      }
    },
    [notifyInitialContentChanged, projectRef, setFileContent],
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
      clearShareReferenceFromURL();
      notifySourceChanged();
      setError("");
      return true;
    },
    [notifySourceChanged, projectRef, setFileContent],
  );

  async function copyOutput() {
    const yaml = staleYaml ?? reply?.result?.yaml;
    if (yaml === undefined) return;
    try {
      await navigator.clipboard.writeText(yaml);
      setNotice(t("yamlCopied"));
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

  const mclEditorServices = {
    onReady: onEditorReady,
    onWorkspaceEditApplierReady: (applier: ApplyWorkspaceEdits | undefined) => {
      workspaceEditApplier.current = applier;
    },
    onDocumentChange,
    onError: onEditorError,
    diagnostics,
    onRun: () => void run(),
    onFormat: () => void formatSource(),
    onComplete: (path: string, position: { line: number; character: number }) =>
      client.current
        ? client.current.complete(sourceForPath(path), path, position, languageServiceFiles())
        : Promise.resolve([]),
    onDefinition: (path: string, position: { line: number; character: number }) =>
      client.current
        ? client.current.definition(sourceForPath(path), path, position, languageServiceFiles())
        : Promise.resolve(null),
    onHover: (path: string, position: { line: number; character: number }) =>
      client.current
        ? client.current.hover(sourceForPath(path), path, position, languageServiceFiles())
        : Promise.resolve(null),
    onNavigate: navigateToDefinition,
    onSelectionChange: handleEditorSelectionChange,
    onNavigateToYaml: navigateToYaml,
    onShowProblems: () => {
      setMobileView("problems");
      setShowProblems(true);
      setShowDiff(false);
    },
    onFindReferences: openSymbolReferences,
    onRenameSymbol: openSymbolRename,
  };
  const textEditorServices = {
    onReady: onEditorReady,
    onDocumentChange,
    onError: onEditorError,
    onRun: () => void run(),
  };

  return (
    <I18nProvider locale={playgroundLocale}>
      <section
        ref={workspace}
        className="playground"
        aria-label={t("workspaceLabel")}
        aria-busy={loadingProject}
      >
        <WorkspaceHeader
          name={activeDraftName}
          draftId={activeDraftId}
          drafts={drafts}
          draftsLoaded={draftsLoaded}
          busy={busy}
          renderPending={renderPending}
          loadingProject={loadingProject}
          editorError={editorError}
          activePath={activePath}
          fileCount={Object.keys(projectFiles).length + 1}
          projectSize={projectSizeBytes}
          settings={editorSettings}
          onSaveName={(name) => updateDraftMetadata(activeDraftId, name)}
          onCancel={cancel}
          onRun={() => void run()}
          onFormat={() => void formatSource()}
          onShare={openShareDialog}
          onOpenExamples={() => setExamplesOpen(true)}
          onOpenCommandPalette={() => setCommandPaletteOpen(true)}
          onOpenDraft={(id) => void openDraft(id)}
          onCreateDraft={createDraft}
          onDuplicateDraft={duplicateDraft}
          onDeleteDraft={() => void deleteCurrentDraft()}
          onLoadProject={loadProject}
          onProjectLoaded={(project) => applyProject(project)}
          onFileError={setError}
          onLoadingProjectChange={setLoadingProject}
          onExportProject={exportProject}
          onSettingsChange={setEditorSettings}
        />
        <PlaygroundQuickAccessDialogs
          examplesOpen={examplesOpen}
          onCloseExamples={() => setExamplesOpen(false)}
          exampleItems={exampleItems}
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
          shareURL={shareURL}
          shareError={shareError}
          onClose={closeShareDialog}
          onShare={() => {
            const copyingExistingLink = Boolean(shareURL);
            void shareProject().then((shared) => {
              if (shared && copyingExistingLink) closeShareDialog();
            });
          }}
        />
        <DraftConflictDialog
          open={draftConflict}
          onFork={() =>
            applyProject(projectRef.current, {
              name: t("projectCopyName", { name: activeDraftName }),
              skipCurrentSnapshot: true,
            })
          }
          onReload={() => void reloadConflictedDraft()}
        />
        <DeleteProjectDialog
          open={deleteProjectOpen}
          projectName={activeDraftName}
          onClose={() => setDeleteProjectOpen(false)}
          onDelete={() => void confirmDeleteCurrentDraft()}
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
        <WorkspaceLayout
          mobileView={mobileView}
          onMobileViewChange={(view) => {
            setMobileView(view);
            if (view === "output") setShowProblems(false);
            if (view === "problems") {
              setShowProblems(true);
              setShowDiff(false);
            }
          }}
          diagnosticsCount={diagnostics.length}
          groupProps={{
            className: "playground-panels",
            groupRef: panelGroup,
            defaultLayout: defaultPanelLayout,
            onLayoutChanged: (layout, meta) => {
              if (meta.isUserInteraction) savePanelLayout(layout);
            },
            orientation,
          }}
          outputPanelRef={outputPanel}
          editorPaneProps={{
            paths: projectPaths,
            files: projectFiles,
            activePath,
            activeSource,
            openPaths,
            explorerOpen,
            disabled: !draftsLoaded || busy || loadingProject || draftConflict,
            readOnly: draftConflict,
            editorAttempt,
            projectGeneration,
            settings: editorSettings,
            mclEditorStates: mclEditorStates.current,
            textEditorStates: textEditorStates.current,
            mclServices: mclEditorServices,
            textEditorServices,
            onToggleExplorer: () => setExplorerOpen((value) => !value),
            onSelectFile: selectFile,
            onCloseFile: (path) => {
              const index = openPaths.indexOf(path);
              const remaining = openPaths.filter((entry) => entry !== path);
              if (path === activePath)
                selectProjectFile(remaining[Math.min(index, remaining.length - 1)] ?? "main.mcl");
              setOpenPaths(remaining.length ? remaining : ["main.mcl"]);
            },
            onCreateFile: requestCreateFile,
            onRenameFile: requestRenameFile,
            onDeleteFile: requestDeleteFile,
          }}
          outputPaneProps={{
            showProblems,
            showResources,
            diagnosticsCount: diagnostics.length,
            onShowResourcesChange: setShowResources,
            onShowProblemsChange: (show) => {
              setShowProblems(show);
              setShowResources(false);
            },
            showDiff,
            onShowDiffChange: (show) => {
              setShowDiff(show);
              setShowResources(false);
            },
            showReferences: symbolReferencesOpen,
            referenceCount: symbolReferenceItems.length,
            onCloseReferences: closeSymbolReferences,
            onOpenReferences: openSymbolReferences,
            canCopyOutput:
              !showProblems &&
              !showDiff &&
              !symbolReferencesOpen &&
              (staleYaml !== undefined || reply?.result?.yaml !== undefined),
            canDownloadOutput:
              !showProblems &&
              !showDiff &&
              !symbolReferencesOpen &&
              (staleYaml !== undefined || reply?.result?.yaml !== undefined),
            canShowDiff:
              staleYaml === undefined &&
              Boolean(reply?.ok) &&
              previousYaml !== undefined &&
              previousYaml !== reply?.result?.yaml,
            canShowResources:
              !showProblems &&
              !showDiff &&
              !symbolReferencesOpen &&
              (staleYaml !== undefined || reply?.result?.yaml !== undefined),
            onCopyOutput: () => void copyOutput(),
            onDownloadOutput: downloadOutput,
            orientation,
            onToggleOrientation: toggleOrientation,
          }}
          resultProps={{
            reply,
            diagnostics,
            navigablePaths: editablePaths,
            staleYaml,
            previousYaml,
            fontSize: editorSettings.fontSize,
            showDiff,
            showProblems,
            showResources,
            onToggleResources: () => setShowResources(!showResources),
            onShowResourcesChange: setShowResources,
            showReferences: symbolReferencesOpen,
            referenceItems: symbolReferenceItems,
            referenceError: symbolReferencesError,
            targetOutputPosition,
            onDiagnostic: goToDiagnostic,
            sourcePositionStore,
            onSourceCandidates: handleSourceCandidates,
          }}
          showProblems={showProblems}
          draftsLoaded={draftsLoaded}
          outputCollapsed={outputCollapsed}
          onToggleOutput={toggleOutputPanel}
          saveStatus={saveStatus}
          wasmStatus={wasmStatus}
          onRetryWasm={() => void retryWasm()}
          pendingInitialImport={pendingInitialImport}
          onOpenDraft={(id) => void openDraft(id)}
          fileCount={Object.keys(projectFiles).length + 1}
          projectSizeBytes={projectSizeBytes}
          activePath={activePath}
        />
        <PlaygroundEditorDialogs
          fileAction={fileAction}
          fileActionError={fileActionError}
          filePathInput={filePathInput}
          onFilePathInputChange={setFilePathInput}
          onCloseFileAction={closeFileAction}
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
            <Button
              onPress={() => {
                setEditorError("");
                setEditorAttempt((attempt) => attempt + 1);
              }}
            >
              {t("retry")}
            </Button>
          </p>
        )}
        {error && <p role="alert">{error}</p>}
        {notice && <p role="status">{notice}</p>}
      </section>
    </I18nProvider>
  );
}
