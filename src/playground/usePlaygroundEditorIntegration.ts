import { useCallback, useRef, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { EditorView } from "@codemirror/view";
import { clearShareReferenceFromURL } from "./usePlaygroundProjectActions";
import type { PlaygroundProject, ProjectMutation } from "./usePlaygroundProject";
import { createSourcePositionStore } from "./sourcePositionStore";
import type { PlaygroundClient, PlaygroundDiagnostic, ProjectFile } from "./types";

type MobileView = "editor" | "output" | "problems";

type Options = {
  client: RefObject<PlaygroundClient | undefined>;
  editor: RefObject<EditorView | undefined>;
  project: RefObject<PlaygroundProject>;
  startupReady: RefObject<boolean>;
  pendingNavigation: RefObject<PlaygroundDiagnostic | undefined>;
  editablePaths: string[];
  setFileContent: (path: string, source: string) => ProjectMutation;
  selectProjectFile: (path: string) => unknown;
  notifyInitialContentChanged: () => void;
  notifySourceChanged: () => void;
  setError: Dispatch<SetStateAction<string>>;
  setEditorError: Dispatch<SetStateAction<string>>;
  setOpenPaths: Dispatch<SetStateAction<string[]>>;
  setRecentPaths: Dispatch<SetStateAction<string[]>>;
  setMobileView: Dispatch<SetStateAction<MobileView>>;
};

export function usePlaygroundEditorIntegration({
  client,
  editor,
  project,
  startupReady,
  pendingNavigation,
  editablePaths,
  setFileContent,
  selectProjectFile,
  notifyInitialContentChanged,
  notifySourceChanged,
  setError,
  setEditorError,
  setOpenPaths,
  setRecentPaths,
  setMobileView,
}: Options) {
  const sourcePositionStore = useRef(createSourcePositionStore()).current;

  const sourceForPath = useCallback(
    (path: string) => {
      if (path === "main.mcl") return project.current.source;
      const file = project.current.files[path];
      return file?.encoding === "utf8" ? file.content : "";
    },
    [project],
  );

  const languageServiceFiles = useCallback((): Record<string, ProjectFile> => {
    const files = Object.assign(Object.create(null), project.current.files) as Record<
      string,
      ProjectFile
    >;
    files["main.mcl"] = { encoding: "utf8", content: project.current.source };
    return files;
  }, [project]);

  const onComplete = useCallback(
    (path: string, position: { line: number; character: number }) =>
      client.current
        ? client.current.complete(sourceForPath(path), path, position, languageServiceFiles())
        : Promise.resolve([]),
    [client, languageServiceFiles, sourceForPath],
  );

  const onDefinition = useCallback(
    (path: string, position: { line: number; character: number }) =>
      client.current
        ? client.current.definition(sourceForPath(path), path, position, languageServiceFiles())
        : Promise.resolve(null),
    [client, languageServiceFiles, sourceForPath],
  );

  const onHover = useCallback(
    (path: string, position: { line: number; character: number }) =>
      client.current
        ? client.current.hover(sourceForPath(path), path, position, languageServiceFiles())
        : Promise.resolve(null),
    [client, languageServiceFiles, sourceForPath],
  );

  const onSelectionChange = useCallback(
    (path: string, line: number, character: number) =>
      sourcePositionStore.set({ path, line, character }),
    [sourcePositionStore],
  );

  const goToEditorPosition = useCallback(
    (diagnostic: PlaygroundDiagnostic) => {
      const view = editor.current;
      if (!view) return;
      const lineNumber = Math.min(Math.max(diagnostic.line, 1), view.state.doc.lines);
      const line = view.state.doc.line(lineNumber);
      const position = Math.min(line.from + Math.max(diagnostic.column - 1, 0), line.to);
      view.dispatch({ selection: { anchor: position }, scrollIntoView: true });
      view.focus();
    },
    [editor],
  );

  const selectFile = useCallback(
    (path: string, diagnostic?: PlaygroundDiagnostic) => {
      setOpenPaths((previous) => (previous.includes(path) ? previous : [...previous, path]));
      if (path === project.current.activePath) return;
      pendingNavigation.current = diagnostic;
      selectProjectFile(path);
      setRecentPaths((previous) => [path, ...previous.filter((entry) => entry !== path)]);
    },
    [pendingNavigation, project, selectProjectFile, setOpenPaths, setRecentPaths],
  );

  const goToDiagnostic = useCallback(
    (diagnostic: PlaygroundDiagnostic) => {
      setMobileView("editor");
      const targetPath = diagnostic.path ?? "main.mcl";
      if (!editablePaths.includes(targetPath)) return;
      if (targetPath !== project.current.activePath) {
        selectFile(targetPath, diagnostic);
        return;
      }
      goToEditorPosition(diagnostic);
    },
    [editablePaths, goToEditorPosition, project, selectFile, setMobileView],
  );

  const onReady = useCallback(
    (view: EditorView | undefined) => {
      editor.current = view;
      if (view && !startupReady.current) view.contentDOM.contentEditable = "false";
      if (
        view &&
        project.current.activePath === "main.mcl" &&
        project.current.source !== view.state.doc.toString()
      ) {
        const result = setFileContent("main.mcl", view.state.doc.toString());
        if (!result.ok) {
          setError(result.error);
          view.dispatch({
            changes: {
              from: 0,
              to: view.state.doc.length,
              insert: project.current.source,
            },
          });
        } else {
          notifyInitialContentChanged();
        }
      }
      const diagnostic = pendingNavigation.current;
      if (view && diagnostic && (diagnostic.path ?? "main.mcl") === project.current.activePath) {
        pendingNavigation.current = undefined;
        goToEditorPosition(diagnostic);
      }
    },
    [
      editor,
      goToEditorPosition,
      notifyInitialContentChanged,
      pendingNavigation,
      project,
      setError,
      setFileContent,
      startupReady,
    ],
  );

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
    [notifySourceChanged, setError, setFileContent],
  );

  const onEditorError = useCallback(
    (cause: Error) => setEditorError(cause.message),
    [setEditorError],
  );

  return {
    goToDiagnostic,
    goToEditorPosition,
    languageServiceFiles,
    onComplete,
    onDefinition,
    onDocumentChange,
    onEditorError,
    onHover,
    onReady,
    onSelectionChange,
    selectFile,
    sourceForPath,
    sourcePositionStore,
  };
}
