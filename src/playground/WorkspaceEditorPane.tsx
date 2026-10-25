import type { ComponentProps } from "react";
import { Button } from "react-aria-components";
import { useTranslation } from "react-i18next";
import { MclEditor } from "./MclEditor";
import { ProjectTabs } from "./ProjectTabs";
import { TextProjectEditor } from "./TextProjectEditor";
import type { EditorSettings } from "./MclEditor";
import type { EditorState } from "@codemirror/state";
import type { ProjectFile } from "./types";

type MclEditorServices = Omit<
  ComponentProps<typeof MclEditor>,
  "path" | "paths" | "source" | "settings" | "editorStates" | "readOnly"
>;

type TextEditorServices = Omit<
  ComponentProps<typeof TextProjectEditor>,
  "path" | "source" | "settings" | "editorStates" | "readOnly"
>;

type Props = {
  paths: string[];
  files: Record<string, ProjectFile>;
  activePath: string;
  activeSource: string;
  openPaths: string[];
  explorerOpen: boolean;
  disabled: boolean;
  readOnly: boolean;
  editorAttempt: number;
  projectGeneration: number;
  settings: EditorSettings;
  mclEditorStates: Map<string, EditorState>;
  textEditorStates: Map<string, EditorState>;
  mclServices: MclEditorServices;
  textEditorServices: TextEditorServices;
  onToggleExplorer: () => void;
  onSelectFile: (path: string) => void;
  onCloseFile: (path: string) => void;
  onCreateFile: () => void;
  onRenameFile: (path: string) => void;
  onDeleteFile: (path: string) => void;
};

export function WorkspaceEditorPane({
  paths,
  files,
  activePath,
  activeSource,
  openPaths,
  explorerOpen,
  disabled,
  readOnly,
  editorAttempt,
  projectGeneration,
  settings,
  mclEditorStates,
  textEditorStates,
  mclServices,
  textEditorServices,
  onToggleExplorer,
  onSelectFile,
  onCloseFile,
  onCreateFile,
  onRenameFile,
  onDeleteFile,
}: Props) {
  const { t } = useTranslation();

  return (
    <>
      <div className="playground-editor-filebar">
        <Button
          className="playground-explorer-toggle"
          aria-label={explorerOpen ? t("closeExplorer") : t("openExplorer")}
          aria-pressed={explorerOpen}
          onPress={onToggleExplorer}
        >
          ▤
        </Button>
        <div className="playground-file-tabs" role="group" aria-label={t("openFiles")}>
          {openPaths.map((path) => (
            <div className="playground-file-tab" key={path}>
              <Button aria-pressed={path === activePath} onPress={() => onSelectFile(path)}>
                {path.split("/").at(-1)}
              </Button>
              {path !== "main.mcl" && (
                <Button
                  className="playground-file-tab-close"
                  aria-label={t("closeFile", { path })}
                  onPress={() => onCloseFile(path)}
                >
                  ×
                </Button>
              )}
            </div>
          ))}
        </div>
        <Button
          className="playground-new-file"
          onPress={onCreateFile}
          isDisabled={disabled}
          aria-label={t("createFile")}
        >
          +
        </Button>
      </div>
      <div className={`playground-editor-workspace${explorerOpen ? " has-explorer" : ""}`}>
        {explorerOpen && (
          <ProjectTabs
            paths={paths}
            files={files}
            activePath={activePath}
            onSelect={onSelectFile}
            onCreate={onCreateFile}
            onRename={onRenameFile}
            onDelete={onDeleteFile}
            disabled={disabled}
          />
        )}
        {activePath.endsWith(".mcl") ? (
          <MclEditor
            key={`${editorAttempt}:${projectGeneration}`}
            path={activePath}
            paths={paths}
            source={activeSource}
            settings={settings}
            editorStates={mclEditorStates}
            readOnly={readOnly}
            {...mclServices}
          />
        ) : (
          <TextProjectEditor
            key={`${editorAttempt}:${projectGeneration}`}
            path={activePath}
            source={activeSource}
            settings={settings}
            editorStates={textEditorStates}
            readOnly={readOnly}
            {...textEditorServices}
          />
        )}
      </div>
    </>
  );
}
