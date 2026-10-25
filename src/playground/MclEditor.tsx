import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  bracketMatching,
  defaultHighlightStyle,
  foldGutter,
  indentUnit,
  indentOnInput,
  syntaxHighlighting,
} from "@codemirror/language";
import { acceptCompletion, closeBrackets } from "@codemirror/autocomplete";
import {
  setDiagnostics,
  lintGutter,
  nextDiagnostic,
  previousDiagnostic,
  type Diagnostic,
} from "@codemirror/lint";
import { mclLanguageSupport } from "@manifest-configuration-language/language";
import {
  Annotation,
  Compartment,
  EditorState,
  StateEffect,
  type Extension,
} from "@codemirror/state";
import { EditorView, drawSelection, keymap, lineNumbers } from "@codemirror/view";
import { history, indentWithTab, toggleComment } from "@codemirror/commands";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { oneDark } from "@codemirror/theme-one-dark";
import { vscodeKeymap } from "@replit/codemirror-vscode-keymap";
import { vim } from "@replit/codemirror-vim";
import { yaml } from "@codemirror/lang-yaml";
import { json } from "@codemirror/lang-json";
import type {
  PlaygroundCompletionItem,
  PlaygroundDefinitionLocation,
  PlaygroundDiagnostic,
  PlaygroundHover,
  PlaygroundRenameEdit,
} from "./types";
import type { PlaygroundShortcuts } from "./keyboardShortcuts";
import { createEditorLanguageServices } from "./editorLanguage";
import initialSource from "../content/docs/examples/resources/configmap/main.mcl?raw";
import "./playgroundPanels.css";

const workspaceEditAnnotation = Annotation.define<boolean>();
const rejectedDocumentChangeAnnotation = Annotation.define<boolean>();

export type ApplyWorkspaceEdits = (
  edits: PlaygroundRenameEdit[],
  sources: Record<string, string>,
) => { ok: true; documents: Record<string, string> } | { ok: false; error: string };

function positionOffset(
  doc: EditorState["doc"],
  position: PlaygroundRenameEdit["range"]["start"],
): number | undefined {
  if (
    !Number.isInteger(position.line) ||
    !Number.isInteger(position.character) ||
    position.line < 0 ||
    position.character < 0 ||
    position.line >= doc.lines
  )
    return undefined;
  const line = doc.line(position.line + 1);
  if (position.character > line.length) return undefined;
  return line.from + position.character;
}

function languageForPath(path: string): Extension {
  if (path.endsWith(".mcl")) return mclLanguageSupport();
  if (path.endsWith(".yaml") || path.endsWith(".yml")) return [yaml(), closeBrackets()];
  if (path.endsWith(".json")) return [json(), closeBrackets()];
  return closeBrackets();
}

export type EditorSettings = {
  theme: "system" | "light" | "dark";
  tabSize: 2 | 4;
  fontSize: 12 | 14 | 16 | 18 | 20;
  lineWrapping: boolean;
  lineNumbers: boolean;
  vim: boolean;
  shortcuts: PlaygroundShortcuts;
};

export { initialSource };

function editorTheme(theme: EditorSettings["theme"]): Extension {
  const dark =
    theme === "dark" ||
    (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  return [
    EditorView.theme(
      {
        "&": { color: "var(--sl-color-text)", backgroundColor: "var(--sl-color-bg)" },
        ".cm-content": { caretColor: "var(--sl-color-text)" },
        ".cm-cursor, .cm-dropCursor": { borderInlineStartColor: "var(--sl-color-text)" },
        ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
          backgroundColor: "var(--playground-editor-selection)",
        },
        ".cm-activeLine, .cm-activeLineGutter": {
          backgroundColor: "var(--playground-editor-active-line)",
        },
        ".cm-gutters": {
          color: "var(--sl-color-gray-2)",
          borderColor: "var(--sl-color-gray-5)",
          backgroundColor: "var(--sl-color-bg)",
        },
      },
      { dark },
    ),
    ...(dark ? [oneDark] : []),
  ];
}

type Props = {
  path: string;
  paths: string[];
  source: string;
  settings: EditorSettings;
  readOnly?: boolean;
  editorStates?: Map<string, EditorState>;
  onReady: (view: EditorView | undefined) => void;
  onWorkspaceEditApplierReady: (applier: ApplyWorkspaceEdits | undefined) => void;
  onDocumentChange: (source: string, path: string) => boolean | void;
  onError: (error: Error) => void;
  diagnostics?: PlaygroundDiagnostic[];
  onRun: () => void;
  onFormat: () => void;
  onComplete: (
    path: string,
    position: { line: number; character: number },
  ) => Promise<PlaygroundCompletionItem[]>;
  onDefinition: (
    path: string,
    position: { line: number; character: number },
  ) => Promise<PlaygroundDefinitionLocation | null>;
  onHover: (
    path: string,
    position: { line: number; character: number },
  ) => Promise<PlaygroundHover | null>;
  onNavigate: (location: PlaygroundDefinitionLocation) => void;
  onSelectionChange: (path: string, line: number, character: number) => void;
  onNavigateToYaml: () => void;
  onShowProblems: () => void;
  onFindReferences: () => void;
  onRenameSymbol: () => void;
};

function toEditorDiagnostics(
  diagnostics: PlaygroundDiagnostic[],
  path: string,
  view: EditorView,
  actionName: (kind: string) => string | undefined,
): Diagnostic[] {
  const doc = view.state.doc;
  const sourceSnapshot = doc.toString();
  const position = (lineNumber: number, column: number) => {
    const line = doc.line(Math.max(1, Math.min(lineNumber, doc.lines)));
    return Math.min(line.to, line.from + Math.max(0, column - 1));
  };

  return diagnostics
    .filter((diagnostic) => (diagnostic.path ?? "main.mcl") === path)
    .map((diagnostic) => {
      const from = position(diagnostic.line, diagnostic.column);
      const to =
        diagnostic.endLine === undefined || diagnostic.endColumn === undefined
          ? Math.min(doc.length, from + 1)
          : Math.max(from, position(diagnostic.endLine, diagnostic.endColumn));
      const severity: Diagnostic["severity"] =
        diagnostic.severity.toLowerCase() === "warning"
          ? "warning"
          : diagnostic.severity.toLowerCase() === "info"
            ? "info"
            : diagnostic.severity.toLowerCase() === "hint"
              ? "hint"
              : "error";
      const actions = diagnostic.actions?.flatMap((action) => {
        const name = actionName(action.kind);
        if (!name) return [];
        const edits = action.edits
          .filter((edit) => edit.path === path)
          .map((edit) => ({
            from: position(edit.range.start.line + 1, edit.range.start.character + 1),
            to: position(edit.range.end.line + 1, edit.range.end.character + 1),
            insert: edit.newText,
          }))
          .sort((left, right) => left.from - right.from);
        if (edits.length !== action.edits.length || edits.length === 0) return [];
        return [
          {
            name,
            apply(currentView: EditorView) {
              if (currentView.state.doc.toString() !== sourceSnapshot) return;
              currentView.dispatch({ changes: edits });
            },
          },
        ];
      });
      return {
        from,
        to,
        severity,
        message: diagnostic.code ? `${diagnostic.code}: ${diagnostic.message}` : diagnostic.message,
        ...(actions?.length ? { actions } : {}),
      };
    });
}

export function MclEditor({
  path,
  paths,
  source,
  settings,
  readOnly = false,
  editorStates,
  onReady,
  onWorkspaceEditApplierReady,
  onDocumentChange,
  onError,
  diagnostics = [],
  onRun,
  onFormat,
  onComplete,
  onDefinition,
  onHover,
  onNavigate,
  onSelectionChange,
  onNavigateToYaml,
  onShowProblems,
  onFindReferences,
  onRenameSymbol,
}: Props) {
  const { t } = useTranslation();
  const translate = useRef(t);
  translate.current = t;
  const [cursorPosition, setCursorPosition] = useState({ line: 1, column: 1 });
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | undefined>(undefined);
  const currentPath = useRef(path);
  const definitionRequest = useRef(0);
  const hoverRequest = useRef(0);
  const documentGeneration = useRef(0);
  const states = useRef(editorStates ?? new Map<string, EditorState>());
  if (editorStates && states.current !== editorStates) states.current = editorStates;
  const extensions = useRef<Extension[]>([]);
  const gutter = useRef(new Compartment());
  const wrapping = useRef(new Compartment());
  const indentation = useRef(new Compartment());
  const textSize = useRef(new Compartment());
  const themeMode = useRef(new Compartment());
  const vimMode = useRef(new Compartment());
  const languageMode = useRef(new Compartment());
  const contentLabel = useRef(new Compartment());
  const readOnlyMode = useRef(new Compartment());
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const callbacks = useRef({
    onReady,
    onWorkspaceEditApplierReady,
    onDocumentChange,
    onError,
    onRun,
    onFormat,
    onComplete,
    onDefinition,
    onHover,
    onNavigate,
    onSelectionChange,
    onNavigateToYaml,
    onShowProblems,
    onFindReferences,
    onRenameSymbol,
  });
  callbacks.current = {
    onReady,
    onWorkspaceEditApplierReady,
    onDocumentChange,
    onError,
    onRun,
    onFormat,
    onComplete,
    onDefinition,
    onHover,
    onNavigate,
    onSelectionChange,
    onNavigateToYaml,
    onShowProblems,
    onFindReferences,
    onRenameSymbol,
  };

  function settingsEffects(next: EditorSettings) {
    return [
      gutter.current.reconfigure(next.lineNumbers ? lineNumbers() : []),
      wrapping.current.reconfigure(next.lineWrapping ? EditorView.lineWrapping : []),
      indentation.current.reconfigure([
        EditorState.tabSize.of(next.tabSize),
        indentUnit.of(" ".repeat(next.tabSize)),
      ]),
      textSize.current.reconfigure(
        EditorView.theme({ ".cm-content, .cm-gutters": { fontSize: `${next.fontSize}px` } }),
      ),
      themeMode.current.reconfigure(editorTheme(next.theme)),
      vimMode.current.reconfigure(next.vim ? vim() : []),
    ];
  }

  useEffect(() => {
    if (!host.current) return;
    let view: EditorView | undefined;
    const languageServices = createEditorLanguageServices({
      callbacks,
      currentPath,
      view: viewRef,
      documentGeneration,
      definitionRequest,
      hoverRequest,
      t: translate,
    });
    try {
      extensions.current = [
        vimMode.current.of(settingsRef.current.vim ? vim() : []),
        gutter.current.of(settingsRef.current.lineNumbers ? lineNumbers() : []),
        wrapping.current.of(settingsRef.current.lineWrapping ? EditorView.lineWrapping : []),
        indentation.current.of([
          EditorState.tabSize.of(settingsRef.current.tabSize),
          indentUnit.of(" ".repeat(settingsRef.current.tabSize)),
        ]),
        indentOnInput(),
        EditorState.allowMultipleSelections.of(true),
        textSize.current.of(
          EditorView.theme({
            ".cm-content, .cm-gutters": { fontSize: `${settingsRef.current.fontSize}px` },
          }),
        ),
        themeMode.current.of(editorTheme(settingsRef.current.theme)),
        drawSelection(),
        contentLabel.current.of(
          EditorView.contentAttributes.of({
            "aria-label": translate.current("fileContentsLabel", { path }),
          }),
        ),
        history(),
        search(),
        highlightSelectionMatches(),
        bracketMatching(),
        foldGutter(),
        languageMode.current.of(languageForPath(path)),
        readOnlyMode.current.of(
          readOnlyRef.current ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : [],
        ),
        lintGutter(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        ...languageServices.extensions,
        EditorView.updateListener.of((update) => {
          if (update.selectionSet || update.docChanged) {
            const line = update.state.doc.lineAt(update.state.selection.main.head);
            setCursorPosition({
              line: line.number,
              column: update.state.selection.main.head - line.from + 1,
            });
            callbacks.current.onSelectionChange(
              currentPath.current,
              line.number - 1,
              update.state.selection.main.head - line.from,
            );
          }
          if (update.selectionSet) {
            definitionRequest.current += 1;
            hoverRequest.current += 1;
          }
          if (update.docChanged) {
            const rejected = update.transactions.some((transaction) =>
              transaction.annotation(rejectedDocumentChangeAnnotation),
            );
            const workspaceEdit = update.transactions.some((transaction) =>
              transaction.annotation(workspaceEditAnnotation),
            );
            if (!rejected && !workspaceEdit) {
              const accepted = callbacks.current.onDocumentChange(
                update.state.doc.toString(),
                currentPath.current,
              );
              if (accepted === false) {
                queueMicrotask(() => {
                  if (viewRef.current !== update.view || update.view.state.doc !== update.state.doc)
                    return;
                  update.view.dispatch({
                    changes: {
                      from: 0,
                      to: update.state.doc.length,
                      insert: update.startState.doc.toString(),
                    },
                    annotations: rejectedDocumentChangeAnnotation.of(true),
                  });
                });
                return;
              }
            }
            states.current.set(currentPath.current, update.view.state);
          }
        }),
        keymap.of([
          {
            key: "Tab",
            run: (view) => acceptCompletion(view) || (indentWithTab.run?.(view) ?? false),
            shift: indentWithTab.shift,
          },
          { key: "Mod-/", run: toggleComment },
          {
            key: "Mod-Enter",
            run: () => {
              callbacks.current.onRun();
              return true;
            },
          },
          {
            key: "Shift-Alt-f",
            run: () => {
              if (!currentPath.current.endsWith(".mcl")) return false;
              callbacks.current.onFormat();
              return true;
            },
          },
          {
            key: "Mod-Shift-y",
            run: () => {
              callbacks.current.onNavigateToYaml();
              return true;
            },
          },
          {
            key: "F2",
            run: () => {
              if (!currentPath.current.endsWith(".mcl")) return false;
              callbacks.current.onRenameSymbol();
              return true;
            },
          },
          {
            key: "Shift-F12",
            run: () => {
              if (!currentPath.current.endsWith(".mcl")) return false;
              callbacks.current.onFindReferences();
              return true;
            },
          },
          {
            key: "Mod-Shift-m",
            run: () => {
              callbacks.current.onShowProblems();
              return true;
            },
            preventDefault: true,
          },
          { key: "F8", run: nextDiagnostic },
          { key: "Shift-F8", run: previousDiagnostic },
          languageServices.definitionKeyBinding,
          ...searchKeymap,
          ...vscodeKeymap,
        ]),
        languageServices.definitionMouseHandler,
      ];
      const cachedState = states.current.get(path);
      const initialState = (
        cachedState?.doc.toString() === source
          ? cachedState.update({ effects: StateEffect.reconfigure.of(extensions.current) }).state
          : EditorState.create({ doc: source, extensions: extensions.current })
      ).update({
        effects: readOnlyMode.current.reconfigure(
          readOnlyRef.current ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : [],
        ),
      }).state;
      states.current.set(path, initialState);
      const initialLine = initialState.doc.lineAt(initialState.selection.main.head);
      setCursorPosition({
        line: initialLine.number,
        column: initialState.selection.main.head - initialLine.from + 1,
      });
      callbacks.current.onSelectionChange(
        path,
        initialLine.number - 1,
        initialState.selection.main.head - initialLine.from,
      );
      view = new EditorView({
        parent: host.current,
        state: initialState,
      });
      viewRef.current = view;
      callbacks.current.onReady(view);
      callbacks.current.onWorkspaceEditApplierReady(applyWorkspaceEdits);
    } catch (cause) {
      callbacks.current.onError(cause instanceof Error ? cause : new Error(String(cause)));
    }
    return () => {
      callbacks.current.onReady(undefined);
      callbacks.current.onWorkspaceEditApplierReady(undefined);
      viewRef.current = undefined;
      view?.destroy();
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: contentLabel.current.reconfigure(
        EditorView.contentAttributes.of({
          "aria-label": translate.current("fileContentsLabel", { path: currentPath.current }),
        }),
      ),
    });
    states.current.set(currentPath.current, view.state);
  }, [t]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: readOnlyMode.current.reconfigure(
        readOnly ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : [],
      ),
    });
  }, [readOnly]);

  function applyWorkspaceEdits(
    edits: PlaygroundRenameEdit[],
    sources: Record<string, string>,
  ): ReturnType<ApplyWorkspaceEdits> {
    const view = viewRef.current;
    const grouped = new Map<string, PlaygroundRenameEdit[]>();
    for (const edit of edits) {
      const group = grouped.get(edit.path) ?? [];
      group.push(edit);
      grouped.set(edit.path, group);
    }

    const staged: Array<{
      path: string;
      transaction: ReturnType<EditorState["update"]>;
      cached: boolean;
    }> = [];
    const documents: Record<string, string> = Object.create(null);
    for (const [editPath, pathEdits] of grouped) {
      const source = sources[editPath];
      if (source === undefined)
        return { ok: false, error: `変更対象のファイルが見つかりません: ${editPath}` };

      const active = editPath === currentPath.current ? view?.state : undefined;
      const cachedState = active ?? states.current.get(editPath);
      if (cachedState && cachedState.doc.toString() !== source)
        return {
          ok: false,
          error: `エディターの内容が最新ではありません。変更を適用しませんでした: ${editPath}`,
        };
      const state = cachedState ?? EditorState.create({ doc: source });
      const changes = pathEdits
        .map((edit) => {
          const from = positionOffset(state.doc, edit.range.start);
          const to = positionOffset(state.doc, edit.range.end);
          return from === undefined || to === undefined || from > to
            ? undefined
            : { from, to, insert: edit.newText };
        })
        .sort((left, right) => (left?.from ?? Infinity) - (right?.from ?? Infinity));
      if (changes.some((change) => change === undefined))
        return {
          ok: false,
          error: `変更位置が現在のファイルと一致しません。変更を適用しませんでした: ${editPath}`,
        };
      const validChanges = changes as Array<{ from: number; to: number; insert: string }>;
      if (
        validChanges.some(
          (change, index) =>
            index > 0 &&
            (validChanges[index - 1].to > change.from ||
              (validChanges[index - 1].from === change.from &&
                validChanges[index - 1].to === change.to)),
        )
      )
        return {
          ok: false,
          error: `変更位置が重複しています。変更を適用しませんでした: ${editPath}`,
        };

      const transaction = state.update({
        changes: validChanges,
        annotations: workspaceEditAnnotation.of(true),
      });
      staged.push({ path: editPath, transaction, cached: cachedState !== undefined });
      documents[editPath] = transaction.state.doc.toString();
    }

    for (const update of staged) {
      if (!update.cached) continue;
      if (update.path === currentPath.current && view) view.dispatch(update.transaction);
      else states.current.set(update.path, update.transaction.state);
    }
    return { ok: true, documents };
  }

  useEffect(() => {
    const view = viewRef.current;
    if (!view || currentPath.current === path) return;
    documentGeneration.current += 1;
    definitionRequest.current += 1;
    hoverRequest.current += 1;
    states.current.set(currentPath.current, view.state);
    currentPath.current = path;
    const cachedState = states.current.get(path);
    const nextState =
      cachedState?.doc.toString() === source
        ? cachedState.update({ effects: StateEffect.reconfigure.of(extensions.current) }).state
        : EditorState.create({ doc: source, extensions: extensions.current });
    states.current.set(path, nextState);
    view.setState(nextState);
    const line = nextState.doc.lineAt(nextState.selection.main.head);
    setCursorPosition({ line: line.number, column: nextState.selection.main.head - line.from + 1 });
    callbacks.current.onSelectionChange(
      path,
      line.number - 1,
      nextState.selection.main.head - line.from,
    );
    view.dispatch({
      effects: [
        languageMode.current.reconfigure(languageForPath(path)),
        contentLabel.current.reconfigure(
          EditorView.contentAttributes.of({
            "aria-label": translate.current("fileContentsLabel", { path }),
          }),
        ),
      ],
    });
    callbacks.current.onReady(view);
  }, [path, source]);

  useEffect(() => {
    const currentPaths = new Set(paths);
    for (const statePath of states.current.keys()) {
      if (!currentPaths.has(statePath)) states.current.delete(statePath);
    }
  }, [paths]);

  useEffect(() => {
    const effects = settingsEffects(settings);
    for (const [statePath, state] of states.current) {
      if (statePath !== currentPath.current)
        states.current.set(statePath, state.update({ effects }).state);
    }
    const view = viewRef.current;
    if (view) {
      view.dispatch({ effects });
      states.current.set(currentPath.current, view.state);
    }
  }, [settings]);

  useEffect(() => {
    if (settings.theme !== "system") return;
    const colorScheme = window.matchMedia("(prefers-color-scheme: dark)");
    const updateTheme = () => {
      const effect = themeMode.current.reconfigure(editorTheme("system"));
      for (const [statePath, state] of states.current) {
        if (statePath !== currentPath.current)
          states.current.set(statePath, state.update({ effects: effect }).state);
      }
      const view = viewRef.current;
      if (view) {
        view.dispatch({ effects: effect });
        states.current.set(currentPath.current, view.state);
      }
    };
    colorScheme.addEventListener("change", updateTheme);
    return () => colorScheme.removeEventListener("change", updateTheme);
  }, [settings.theme]);

  useEffect(() => {
    const view = viewRef.current;
    if (view)
      view.dispatch(
        setDiagnostics(
          view.state,
          toEditorDiagnostics(diagnostics, path, view, (kind) =>
            kind === "removeUnreachableDefinition" ? t("removeUnreachableDefinition") : undefined,
          ),
        ),
      );
  }, [diagnostics, path, t]);

  const languageLabel = path.endsWith(".mcl")
    ? "MCL"
    : path.endsWith(".yaml") || path.endsWith(".yml")
      ? "YAML"
      : path.endsWith(".json")
        ? "JSON"
        : "TEXT";

  return (
    <section className="playground-code-surface" aria-label={t("editorSurface")}>
      <header className="playground-code-header">
        <span className="playground-code-heading">{t("edit")}</span>
        <span className="playground-code-file" title={path}>
          {path}
        </span>
        <span className="playground-code-language">{languageLabel}</span>
        <span
          className="playground-editor-position"
          aria-label={t("editorPosition", {
            line: cursorPosition.line,
            column: cursorPosition.column,
          })}
        >
          {t("editorPositionShort", cursorPosition)}
        </span>
      </header>
      <div className="playground-editor" ref={host} />
    </section>
  );
}
