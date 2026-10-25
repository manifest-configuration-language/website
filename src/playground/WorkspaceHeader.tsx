import { Button } from "react-aria-components";
import { useTranslation } from "react-i18next";
import type { EditorSettings } from "./MclEditor";
import { ProjectFileInput } from "./ProjectFileInput";
import { PlaygroundSettingsDialog } from "./PlaygroundSettingsDialog";
import { ProjectName } from "./ProjectName";
import type { DraftMetadata } from "./usePlaygroundPersistence";
import type { LoadedProject } from "./types";

type Props = {
  name: string;
  draftId: string;
  drafts: DraftMetadata[];
  draftsLoaded: boolean;
  busy: boolean;
  renderPending: boolean;
  loadingProject: boolean;
  editorError: string;
  activePath: string;
  fileCount: number;
  projectSize: number;
  settings: EditorSettings;
  onSaveName: (name: string) => void;
  onCancel: () => void;
  onRun: () => void;
  onFormat: () => void;
  onShare: () => void;
  onOpenExamples: () => void;
  onOpenCommandPalette: () => void;
  onOpenDraft: (id: string) => void;
  onCreateDraft: () => void;
  onDuplicateDraft: () => void;
  onDeleteDraft: () => void;
  onLoadProject: (files: File[]) => Promise<LoadedProject>;
  onProjectLoaded: (project: LoadedProject) => void;
  onFileError: (message: string) => void;
  onLoadingProjectChange: (loading: boolean) => void;
  onExportProject: () => Promise<void>;
  onSettingsChange: (settings: EditorSettings) => void;
};

export function WorkspaceHeader({
  name,
  draftId,
  drafts,
  draftsLoaded,
  busy,
  renderPending,
  loadingProject,
  editorError,
  activePath,
  fileCount,
  projectSize,
  settings,
  onSaveName,
  onCancel,
  onRun,
  onFormat,
  onShare,
  onOpenExamples,
  onOpenCommandPalette,
  onOpenDraft,
  onCreateDraft,
  onDuplicateDraft,
  onDeleteDraft,
  onLoadProject,
  onProjectLoaded,
  onFileError,
  onLoadingProjectChange,
  onExportProject,
  onSettingsChange,
}: Props) {
  const { t } = useTranslation();

  return (
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
        <ProjectName name={name} disabled={!draftsLoaded || !draftId} onSave={onSaveName} />
      </div>
      <div className="playground-toolbar">
        <div className="playground-primary-actions" role="group" aria-label={t("editActions")}>
          {busy || renderPending ? (
            <Button onPress={onCancel}>{t("stop")}</Button>
          ) : (
            <>
              <Button
                className="playground-run-button"
                onPress={onRun}
                isDisabled={!draftsLoaded || loadingProject || Boolean(editorError)}
                aria-keyshortcuts="Control+Enter Meta+Enter"
              >
                {t("run")}
                <kbd>Ctrl/⌘ Enter</kbd>
              </Button>
              <Button
                onPress={onFormat}
                aria-keyshortcuts="Shift+Alt+F"
                isDisabled={
                  !draftsLoaded ||
                  loadingProject ||
                  Boolean(editorError) ||
                  !activePath.endsWith(".mcl")
                }
              >
                {t("formatSource")}
              </Button>
            </>
          )}
          <Button onPress={onShare} isDisabled={!draftsLoaded || busy || loadingProject}>
            {t("share")}
          </Button>
          <Button
            onPress={onOpenExamples}
            isDisabled={!draftsLoaded || busy || loadingProject}
            aria-haspopup="dialog"
          >
            {t("openExamples")}
          </Button>
        </div>
        <div className="playground-secondary-actions">
          <Button
            className="playground-command-button"
            onPress={onOpenCommandPalette}
            aria-keyshortcuts="Control+Shift+P Meta+Shift+P"
          >
            {t("commandSearch")}
            <kbd>Ctrl/⌘ ⇧ P</kbd>
          </Button>
          <details className="playground-more">
            <summary>{t("projectMenu")}</summary>
            <div className="playground-more-menu">
              <label className="playground-project-picker">
                <span>{t("openProject")}</span>
                <select
                  aria-label={t("openProject")}
                  value={draftId}
                  disabled={!draftsLoaded || busy || loadingProject}
                  onChange={(event) => onOpenDraft(event.currentTarget.value)}
                >
                  {drafts.map((draft) => (
                    <option key={draft.id} value={draft.id}>
                      {draft.name === "作業" ? t("unnamedProject") : draft.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="playground-project-actions">
                <Button
                  onPress={onCreateDraft}
                  isDisabled={!draftsLoaded || busy || loadingProject}
                >
                  {t("commandNewProject")}
                </Button>
                <Button
                  onPress={onDuplicateDraft}
                  isDisabled={!draftsLoaded || busy || loadingProject}
                >
                  {t("duplicateProject")}
                </Button>
                <Button
                  onPress={onDeleteDraft}
                  isDisabled={!draftsLoaded || busy || loadingProject}
                >
                  {t("deleteProject")}
                </Button>
              </div>
              <ProjectFileInput
                fileCount={fileCount}
                projectSize={projectSize}
                onLoad={onLoadProject}
                onLoaded={onProjectLoaded}
                onError={onFileError}
                onLoading={onLoadingProjectChange}
                onExport={onExportProject}
                disabled={!draftsLoaded || busy || loadingProject || Boolean(editorError)}
              />
              <a href="/playground/capabilities/">{t("projectCapabilities")}</a>
            </div>
          </details>
          <PlaygroundSettingsDialog settings={settings} onChange={onSettingsChange} />
        </div>
      </div>
    </header>
  );
}
