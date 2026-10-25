import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  bracketMatching,
  defaultHighlightStyle,
  foldGutter,
  indentUnit,
  indentOnInput,
  syntaxHighlighting,
} from "@codemirror/language";
import { closeBrackets } from "@codemirror/autocomplete";
import { json } from "@codemirror/lang-json";
import { yaml } from "@codemirror/lang-yaml";
import {
  Annotation,
  Compartment,
  EditorState,
  Transaction,
  type Extension,
} from "@codemirror/state";
import { EditorView, drawSelection, keymap, lineNumbers } from "@codemirror/view";
import { history, indentWithTab, toggleComment } from "@codemirror/commands";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { oneDark } from "@codemirror/theme-one-dark";
import { vscodeKeymap } from "@replit/codemirror-vscode-keymap";
import { vim } from "@replit/codemirror-vim";
import type { EditorSettings } from "./MclEditor";
import "./TextProjectEditor.css";

type Props = {
  path: string;
  source: string;
  settings: EditorSettings;
  readOnly?: boolean;
  editorStates: Map<string, EditorState>;
  onReady: (view: EditorView | undefined) => void;
  onDocumentChange: (source: string, path: string) => boolean | void;
  onError: (error: Error) => void;
  onRun: () => void;
};

const rejectedDocumentChange = Annotation.define<boolean>();

function languageForPath(path: string): Extension {
  if (path.endsWith(".yaml") || path.endsWith(".yml")) return [yaml(), closeBrackets()];
  if (path.endsWith(".json")) return [json(), closeBrackets()];
  return closeBrackets();
}

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

export function TextProjectEditor({
  path,
  source,
  settings,
  readOnly = false,
  editorStates,
  onReady,
  onDocumentChange,
  onError,
  onRun,
}: Props) {
  const { t } = useTranslation();
  const translate = useRef(t);
  translate.current = t;
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | undefined>(undefined);
  const states = useRef(editorStates);
  if (states.current !== editorStates) states.current = editorStates;
  const currentPath = useRef(path);
  const pathRef = useRef(path);
  pathRef.current = path;
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const callbacks = useRef({ onReady, onDocumentChange, onError, onRun });
  callbacks.current = { onReady, onDocumentChange, onError, onRun };
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
  const [cursorPosition, setCursorPosition] = useState({ line: 1, column: 1 });

  const createEditorState = useCallback((documentPath: string, documentSource: string) => {
    return EditorState.create({
      doc: documentSource,
      extensions: [
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
            "aria-label": translate.current("fileContentsLabel", { path: documentPath }),
          }),
        ),
        history(),
        search(),
        highlightSelectionMatches(),
        bracketMatching(),
        foldGutter(),
        languageMode.current.of(languageForPath(documentPath)),
        readOnlyMode.current.of(
          readOnlyRef.current ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : [],
        ),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        keymap.of([
          {
            key: "Tab",
            run: (view) => indentWithTab.run?.(view) ?? false,
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
          ...searchKeymap,
          ...vscodeKeymap,
        ]),
        EditorView.updateListener.of((update) => {
          states.current.set(currentPath.current, update.state);
          if (update.selectionSet || update.docChanged) {
            const line = update.state.doc.lineAt(update.state.selection.main.head);
            setCursorPosition({
              line: line.number,
              column: update.state.selection.main.head - line.from + 1,
            });
          }
          if (update.docChanged) {
            const rejected = update.transactions.some((transaction) =>
              transaction.annotation(rejectedDocumentChange),
            );
            if (
              !rejected &&
              callbacks.current.onDocumentChange(
                update.state.doc.toString(),
                currentPath.current,
              ) === false
            ) {
              queueMicrotask(() => {
                if (viewRef.current !== update.view || update.view.state.doc !== update.state.doc)
                  return;
                update.view.dispatch({
                  changes: {
                    from: 0,
                    to: update.state.doc.length,
                    insert: update.startState.doc.toString(),
                  },
                  annotations: rejectedDocumentChange.of(true),
                });
              });
            }
          }
        }),
      ],
    });
  }, []);

  useEffect(() => {
    const parent = host.current;
    if (!parent) return;

    try {
      const state = createEditorState(pathRef.current, sourceRef.current);
      const view = new EditorView({ parent, state });
      viewRef.current = view;
      states.current.set(path, view.state);
      callbacks.current.onReady(view);
    } catch (cause) {
      callbacks.current.onError(cause instanceof Error ? cause : new Error(String(cause)));
    }

    return () => {
      callbacks.current.onReady(undefined);
      viewRef.current?.destroy();
      viewRef.current = undefined;
    };
  }, [createEditorState]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: readOnlyMode.current.reconfigure(
        readOnly ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : [],
      ),
    });
  }, [readOnly]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    const pathChanged = currentPath.current !== path;
    if (pathChanged) {
      states.current.set(currentPath.current, view.state);
      currentPath.current = path;
      const cachedState = states.current.get(path);
      const nextState =
        cachedState?.doc.toString() === source ? cachedState : createEditorState(path, source);
      view.setState(nextState);
    }

    if (view.state.doc.toString() !== source) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: source },
        annotations: Transaction.addToHistory.of(false),
      });
    }
    if (pathChanged) {
      view.dispatch({
        effects: [
          languageMode.current.reconfigure(languageForPath(path)),
          contentLabel.current.reconfigure(
            EditorView.contentAttributes.of({
              "aria-label": translate.current("fileContentsLabel", { path }),
            }),
          ),
          readOnlyMode.current.reconfigure(
            readOnlyRef.current
              ? [EditorState.readOnly.of(true), EditorView.editable.of(false)]
              : [],
          ),
        ],
      });
    }
    states.current.set(path, view.state);
  }, [createEditorState, editorStates, path, source]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: [
        gutter.current.reconfigure(settings.lineNumbers ? lineNumbers() : []),
        wrapping.current.reconfigure(settings.lineWrapping ? EditorView.lineWrapping : []),
        indentation.current.reconfigure([
          EditorState.tabSize.of(settings.tabSize),
          indentUnit.of(" ".repeat(settings.tabSize)),
        ]),
        textSize.current.reconfigure(
          EditorView.theme({ ".cm-content, .cm-gutters": { fontSize: `${settings.fontSize}px` } }),
        ),
        themeMode.current.reconfigure(editorTheme(settings.theme)),
        vimMode.current.reconfigure(settings.vim ? vim() : []),
      ],
    });
    states.current.set(currentPath.current, view.state);
  }, [settings]);

  useEffect(() => {
    if (settings.theme !== "system") return;
    const colorScheme = window.matchMedia("(prefers-color-scheme: dark)");
    const updateTheme = () => {
      viewRef.current?.dispatch({
        effects: themeMode.current.reconfigure(editorTheme("system")),
      });
    };
    colorScheme.addEventListener("change", updateTheme);
    return () => colorScheme.removeEventListener("change", updateTheme);
  }, [settings.theme]);

  const languageLabel =
    path.endsWith(".yaml") || path.endsWith(".yml")
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
      <div className="playground-editor text-project-editor" ref={host} />
    </section>
  );
}
