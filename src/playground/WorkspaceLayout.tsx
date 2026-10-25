import type { ComponentProps } from "react";
import { Button } from "react-aria-components";
import { useTranslation } from "react-i18next";
import type { RuntimeStatus } from "@manifest-configuration-language/browser";
import type { DraftSaveStatus } from "./usePlaygroundPersistence";
import { WorkspaceEditorPane } from "./WorkspaceEditorPane";
import { WorkspaceOutputPane } from "./WorkspaceOutputPane";
import { PlaygroundResult } from "./PlaygroundResult";
import { Group, Panel, Separator } from "react-resizable-panels";

type MobileView = "editor" | "output" | "problems";
type GroupProps = Omit<ComponentProps<typeof Group>, "children">;
type EditorPaneProps = ComponentProps<typeof WorkspaceEditorPane>;
type OutputPaneProps = Omit<ComponentProps<typeof WorkspaceOutputPane>, "children">;
type ResultProps = ComponentProps<typeof PlaygroundResult>;

type Props = {
  mobileView: MobileView;
  onMobileViewChange: (view: MobileView) => void;
  diagnosticsCount: number;
  groupProps: GroupProps;
  outputPanelRef: ComponentProps<typeof Panel>["panelRef"];
  editorPaneProps: EditorPaneProps;
  outputPaneProps: OutputPaneProps;
  resultProps: ResultProps;
  showProblems: boolean;
  draftsLoaded: boolean;
  outputCollapsed: boolean;
  onToggleOutput: () => void;
  saveStatus: DraftSaveStatus;
  wasmStatus: RuntimeStatus | "waiting";
  onRetryWasm: () => void;
  pendingInitialImport?: { id: string; name: string };
  onOpenDraft: (id: string) => void;
  fileCount: number;
  projectSizeBytes: number;
  activePath: string;
};

export function WorkspaceLayout({
  mobileView,
  onMobileViewChange,
  diagnosticsCount,
  groupProps,
  outputPanelRef,
  editorPaneProps,
  outputPaneProps,
  resultProps,
  showProblems,
  draftsLoaded,
  outputCollapsed,
  onToggleOutput,
  saveStatus,
  wasmStatus,
  onRetryWasm,
  pendingInitialImport,
  onOpenDraft,
  fileCount,
  projectSizeBytes,
  activePath,
}: Props) {
  const { t } = useTranslation();

  return (
    <>
      <nav className="playground-mobile-views" aria-label={t("viewMode")}>
        <Button aria-pressed={mobileView === "editor"} onPress={() => onMobileViewChange("editor")}>
          {t("editor")}
        </Button>
        <Button aria-pressed={mobileView === "output"} onPress={() => onMobileViewChange("output")}>
          {t("output")}
        </Button>
        <Button
          aria-pressed={mobileView === "problems"}
          onPress={() => onMobileViewChange("problems")}
        >
          {t("problemsCount", { count: diagnosticsCount })}
        </Button>
      </nav>
      <div className="playground-output-collapse-control">
        <Button aria-controls="output" aria-expanded={!outputCollapsed} onPress={onToggleOutput}>
          {outputCollapsed ? t("showOutput") : t("hideOutput")}
        </Button>
      </div>
      <Group {...groupProps} data-mobile-view={mobileView}>
        <Panel id="editor" className="playground-editor-panel" defaultSize="60" minSize="25">
          <WorkspaceEditorPane {...editorPaneProps} />
        </Panel>
        <Separator className="playground-resize-handle" aria-label={t("resizePanels")} />
        <Panel
          id="output"
          className="playground-output-panel"
          panelRef={outputPanelRef}
          defaultSize="40"
          minSize="25"
          collapsedSize={0}
          collapsible
        >
          <WorkspaceOutputPane {...outputPaneProps}>
            <PlaygroundResult {...resultProps} />
            {showProblems && draftsLoaded && diagnosticsCount === 0 && (
              <p className="playground-no-problems">{t("noProblems")}</p>
            )}
          </WorkspaceOutputPane>
        </Panel>
      </Group>
      <footer className="playground-statusbar" aria-label={t("projectStatus")}>
        <span className={`playground-save-status playground-save-${saveStatus}`} aria-live="polite">
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
        {wasmStatus === "error" && <Button onPress={onRetryWasm}>{t("retry")}</Button>}
        <span>{t("problemsCount", { count: diagnosticsCount })}</span>
        {pendingInitialImport && (
          <Button onPress={() => onOpenDraft(pendingInitialImport.id)}>
            {t("openImportedProject", { name: pendingInitialImport.name })}
          </Button>
        )}
        <span>{t("filesCount", { count: fileCount })}</span>
        <span>{(projectSizeBytes / 1024 / 1024).toFixed(1)} MiB</span>
        <span className="playground-status-path">{activePath}</span>
      </footer>
    </>
  );
}
