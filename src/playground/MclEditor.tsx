import { useEffect, useRef } from "react";
import {
  bracketMatching,
  defaultHighlightStyle,
  foldGutter,
  foldKeymap,
  indentUnit,
  syntaxHighlighting,
} from "@codemirror/language";
import { setDiagnostics, lintGutter, type Diagnostic } from "@codemirror/lint";
import { searchKeymap } from "@codemirror/search";
import { mclLanguageSupport } from "@manifest-configuration-language/language";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView, drawSelection, keymap, lineNumbers } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { closeBracketsKeymap } from "@codemirror/autocomplete";
import { vim } from "@replit/codemirror-vim";
import { yaml } from "@codemirror/lang-yaml";
import { json } from "@codemirror/lang-json";
import type {
  PlaygroundCompletionItem,
  PlaygroundDefinitionLocation,
  PlaygroundDiagnostic,
  PlaygroundHover,
} from "./types";
import { createEditorLanguageServices } from "./editorLanguage";

function languageForPath(path: string): Extension {
  if (path.endsWith(".mcl")) return mclLanguageSupport();
  if (path.endsWith(".yaml") || path.endsWith(".yml")) return yaml();
  if (path.endsWith(".json")) return json();
  return [];
}

export type EditorSettings = {
  tabSize: 2 | 4;
  fontSize: 12 | 14 | 16 | 18 | 20;
  lineWrapping: boolean;
  lineNumbers: boolean;
  vim: boolean;
};

export const initialSource = `let appName = "catalog"
let configMap =
  apiVersion: "v1"
  kind: "ConfigMap"
  metadata:
    name: appName
  data:
    mode: "development"

emit configMap
`;

type Props = {
  path: string;
  paths: string[];
  source: string;
  settings: EditorSettings;
  onReady: (view: EditorView | undefined) => void;
  onDocumentChange: (source: string, path: string) => void;
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
  onNavigateToYaml: () => void;
};

function toEditorDiagnostics(
  diagnostics: PlaygroundDiagnostic[],
  path: string,
  view: EditorView,
): Diagnostic[] {
  const doc = view.state.doc;
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
      return {
        from,
        to,
        severity,
        message: diagnostic.code ? `${diagnostic.code}: ${diagnostic.message}` : diagnostic.message,
      };
    });
}

export function MclEditor({
  path,
  paths,
  source,
  settings,
  onReady,
  onDocumentChange,
  onError,
  diagnostics = [],
  onRun,
  onFormat,
  onComplete,
  onDefinition,
  onHover,
  onNavigate,
  onNavigateToYaml,
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | undefined>(undefined);
  const currentPath = useRef(path);
  const definitionRequest = useRef(0);
  const hoverRequest = useRef(0);
  const documentGeneration = useRef(0);
  const states = useRef(new Map<string, EditorState>());
  const extensions = useRef<Extension[]>([]);
  const gutter = useRef(new Compartment());
  const wrapping = useRef(new Compartment());
  const indentation = useRef(new Compartment());
  const textSize = useRef(new Compartment());
  const vimMode = useRef(new Compartment());
  const languageMode = useRef(new Compartment());
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const callbacks = useRef({
    onReady,
    onDocumentChange,
    onError,
    onRun,
    onFormat,
    onComplete,
    onDefinition,
    onHover,
    onNavigate,
    onNavigateToYaml,
  });
  callbacks.current = {
    onReady,
    onDocumentChange,
    onError,
    onRun,
    onFormat,
    onComplete,
    onDefinition,
    onHover,
    onNavigate,
    onNavigateToYaml,
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
        textSize.current.of(
          EditorView.theme({
            ".cm-content, .cm-gutters": { fontSize: `${settingsRef.current.fontSize}px` },
          }),
        ),
        drawSelection(),
        EditorView.contentAttributes.of({ "aria-label": `${path}の内容` }),
        history(),
        bracketMatching(),
        foldGutter(),
        languageMode.current.of(languageForPath(path)),
        lintGutter(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        ...languageServices.extensions,
        EditorView.updateListener.of((update) => {
          if (update.selectionSet) {
            definitionRequest.current += 1;
            hoverRequest.current += 1;
          }
          if (update.docChanged) {
            states.current.set(currentPath.current, update.state);
            callbacks.current.onDocumentChange(update.state.doc.toString(), currentPath.current);
          }
        }),
        keymap.of([
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
          languageServices.definitionKeyBinding,
          ...closeBracketsKeymap,
          indentWithTab,
          ...searchKeymap,
          ...foldKeymap,
          ...defaultKeymap,
          ...historyKeymap,
        ]),
        languageServices.definitionMouseHandler,
      ];
      const initialState = EditorState.create({ doc: source, extensions: extensions.current });
      states.current.set(path, initialState);
      view = new EditorView({
        parent: host.current,
        state: initialState,
      });
      viewRef.current = view;
      callbacks.current.onReady(view);
    } catch (cause) {
      callbacks.current.onError(cause instanceof Error ? cause : new Error(String(cause)));
    }
    return () => {
      callbacks.current.onReady(undefined);
      viewRef.current = undefined;
      view?.destroy();
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || currentPath.current === path) return;
    documentGeneration.current += 1;
    definitionRequest.current += 1;
    hoverRequest.current += 1;
    states.current.set(currentPath.current, view.state);
    currentPath.current = path;
    const nextState =
      states.current.get(path) ??
      EditorState.create({ doc: source, extensions: extensions.current }).update({
        effects: settingsEffects(settingsRef.current),
      }).state;
    states.current.set(path, nextState);
    view.setState(nextState);
    view.dispatch({ effects: languageMode.current.reconfigure(languageForPath(path)) });
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
    const view = viewRef.current;
    if (view)
      view.dispatch(setDiagnostics(view.state, toEditorDiagnostics(diagnostics, path, view)));
  }, [diagnostics, path]);

  return <div className="playground-editor" ref={host} />;
}
