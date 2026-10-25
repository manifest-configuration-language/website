import { toggleComment } from "@codemirror/commands";
import { selectNextOccurrence, selectSelectionMatches } from "@codemirror/search";
import type { EditorView } from "@codemirror/view";
import type { TFunction } from "i18next";
import type { QuickAccessItem } from "./QuickAccessList";
import type { PlaygroundShortcuts } from "./keyboardShortcuts";
import { formatShortcut } from "./keyboardShortcuts";

type PlaygroundCommandActions = {
  editor: { current: EditorView | undefined };
  activePath: string;
  hasSourceMap: boolean;
  run: () => void;
  format: () => void;
  openExamples: () => void;
  toggleExplorer: () => void;
  goToDefinition: () => void;
  goToYaml: () => void;
  findReferences: () => void;
  renameSymbol: () => void;
  share: () => void;
  openFile: () => void;
  createFile: () => void;
  newProject: () => void;
  showOutput: () => void;
  showProblems: () => void;
  closePalette: () => void;
  shortcuts: PlaygroundShortcuts;
};

export function createPlaygroundCommandItems(
  t: TFunction<"starlight">,
  actions: PlaygroundCommandActions,
): QuickAccessItem[] {
  const mclFile = actions.activePath.endsWith(".mcl");
  const add = (
    key: keyof StarlightApp.I18n,
    action: () => void,
    shortcut?: string,
    keywords?: string[],
  ) => {
    const label = t(key) as string;
    return {
      value: label,
      label,
      ...(shortcut ? { shortcut } : {}),
      ...(keywords ? { keywords } : {}),
      onSelect: () => {
        actions.closePalette();
        action();
      },
    } satisfies QuickAccessItem;
  };
  const editorAction = (command: (view: EditorView) => void) => () => {
    const view = actions.editor.current;
    if (!view) return;
    view.focus();
    command(view);
  };

  return [
    add("commandRun", actions.run, "Ctrl/⌘ Enter", ["run", "render"]),
    ...(mclFile
      ? [add("commandFormat", actions.format, "Shift+Alt+F", ["format", "document"])]
      : []),
    add("commandToggleComment", editorAction(toggleComment), "Ctrl/⌘ /", [
      "toggle comment",
      "line comment",
      "ctrl slash",
    ]),
    add("commandNextOccurrence", editorAction(selectNextOccurrence), "Ctrl/⌘ D", [
      "select next occurrence",
      "multi cursor",
      "ctrl d",
    ]),
    add("commandSelectMatches", editorAction(selectSelectionMatches), "Ctrl/⌘ ⇧ L", [
      "select all occurrences",
      "multi cursor",
      "ctrl shift l",
    ]),
    add("commandOpenExamples", actions.openExamples, undefined, ["examples"]),
    add(
      "commandToggleExplorer",
      actions.toggleExplorer,
      formatShortcut(actions.shortcuts.toggleExplorer),
      ["explorer", "files", "ctrl shift e"],
    ),
    ...(mclFile
      ? [
          add("commandGoToDefinition", actions.goToDefinition, "F12", ["definition", "f12"]),
          ...(actions.hasSourceMap
            ? [add("commandGoToYaml", actions.goToYaml, undefined, ["source map", "yaml"])]
            : []),
          add("commandFindReferences", actions.findReferences, "Shift+F12", [
            "references",
            "shift f12",
          ]),
          add("commandRenameSymbol", actions.renameSymbol, "F2", ["rename", "f2"]),
        ]
      : []),
    add("commandShare", actions.share, undefined, ["share"]),
    add("commandOpenFile", actions.openFile, formatShortcut(actions.shortcuts.quickOpen), [
      "quick open",
      "open file",
    ]),
    add("commandCreateFile", actions.createFile, undefined, ["new file", "create file"]),
    add("commandNewProject", actions.newProject, undefined, ["new project"]),
    add("commandShowOutput", actions.showOutput, undefined, ["output"]),
    add(
      "commandShowProblems",
      actions.showProblems,
      formatShortcut(actions.shortcuts.showProblems),
      ["problems", "diagnostics", "ctrl shift m"],
    ),
  ];
}
