import { useState, type RefObject, type SyntheticEvent } from "react";
import type { EditorView } from "@codemirror/view";
import type { ApplyWorkspaceEdits } from "./MclEditor";
import type {
  PlaygroundClient,
  PlaygroundDefinitionLocation,
  PlaygroundDiagnostic,
  PlaygroundReference,
  PlaygroundRenameEdit,
  PlaygroundReply,
  PlaygroundSourceMap,
  ProjectFile,
} from "./types";
import type { PlaygroundProject } from "./usePlaygroundProject";

type PendingSymbolRename = {
  edits: PlaygroundRenameEdit[];
  sources: Record<string, string>;
  revision: number;
};

export type RenamePreviewEntry = {
  path: string;
  line: number;
  before: string;
  after: string;
};

type OutputPosition = { line: number; character: number; requestId: number };

type Args = {
  editor: RefObject<EditorView | undefined>;
  client: RefObject<PlaygroundClient | undefined>;
  project: RefObject<PlaygroundProject>;
  revision: RefObject<number>;
  workspaceEditApplier: RefObject<ApplyWorkspaceEdits | undefined>;
  mclPaths: string[];
  activePath: string;
  currentSourceMap?: PlaygroundSourceMap;
  reply?: PlaygroundReply;
  languageServiceFiles: () => Record<string, ProjectFile>;
  sourceForPath: (path: string) => string;
  selectFile: (path: string, diagnostic?: PlaygroundDiagnostic) => void;
  goToEditorPosition: (diagnostic: PlaygroundDiagnostic) => void;
  replaceProjectState: (
    source: string,
    files: Record<string, ProjectFile>,
    activePath: string,
  ) => void;
  finishProjectMutation: () => Promise<void>;
  setMobileView: (view: "editor" | "output" | "problems") => void;
  setTargetOutputPosition: (position: OutputPosition | undefined) => void;
  setShowProblems: (show: boolean) => void;
  setShowDiff: (show: boolean) => void;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
};

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

export function renamePreviewEntries(
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

export function usePlaygroundLanguageActions({
  editor,
  client,
  project,
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
  onNotice,
  onError,
}: Args) {
  const [symbolRenameOpen, setSymbolRenameOpen] = useState(false);
  const [symbolRenameInput, setSymbolRenameInput] = useState("");
  const [symbolRenameError, setSymbolRenameError] = useState("");
  const [pendingSymbolRename, setPendingSymbolRename] = useState<PendingSymbolRename>();
  const [symbolReferences, setSymbolReferences] = useState<PlaygroundReference[]>([]);
  const [symbolReferencesError, setSymbolReferencesError] = useState("");
  const [symbolReferencesOpen, setSymbolReferencesOpen] = useState(false);

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
    if (location.path !== project.current.activePath) {
      selectFile(location.path, navigation);
      return;
    }
    goToEditorPosition(navigation);
  }

  async function goToDefinitionAtCursor() {
    const view = editor.current;
    const playground = client.current;
    const path = project.current.activePath;
    if (!view || !playground || !path.endsWith(".mcl")) return;

    const cursor = view.state.selection.main.head;
    const sourceLine = view.state.doc.lineAt(cursor);
    const position = { line: sourceLine.number - 1, character: cursor - sourceLine.from };
    const currentRevision = revision.current;
    onError("");
    onNotice("");
    try {
      const location = await playground.definition(
        view.state.doc.toString(),
        path,
        position,
        languageServiceFiles(),
      );
      if (currentRevision !== revision.current || editor.current !== view) return;
      if (location) navigateToDefinition(location);
      else onNotice("この位置に定義はありません");
    } catch (cause) {
      if (currentRevision !== revision.current || editor.current !== view) return;
      onError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function findSymbolReferences() {
    const view = editor.current;
    const playground = client.current;
    const path = project.current.activePath;
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
    if (path !== project.current.activePath) {
      selectFile(path, navigation);
      return;
    }
    goToEditorPosition(navigation);
  }

  function navigateToYaml() {
    const view = editor.current;
    if (!view || !currentSourceMap || !activePath.endsWith(".mcl")) return;
    const position = outputPositionForSource(currentSourceMap, view, activePath);
    if (!position || !reply) return;
    setTargetOutputPosition({ ...position, requestId: reply.requestId });
    setShowProblems(false);
    setShowDiff(false);
    setMobileView("output");
  }

  async function renameSymbol(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const view = editor.current;
    const playground = client.current;
    const path = project.current.activePath;
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

    const currentProject = project.current;
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
    onNotice("シンボル名を変更しました");
  }

  function openSymbolRename() {
    setSymbolRenameError("");
    setSymbolRenameInput("");
    setPendingSymbolRename(undefined);
    setSymbolRenameOpen(true);
  }

  function closeSymbolRename() {
    setSymbolRenameOpen(false);
    setPendingSymbolRename(undefined);
  }

  function resetSymbolRename() {
    setPendingSymbolRename(undefined);
    setSymbolRenameError("");
  }

  function closeSymbolReferences() {
    setSymbolReferencesOpen(false);
  }

  return {
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
  };
}
