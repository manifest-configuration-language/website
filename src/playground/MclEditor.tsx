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
import { EditorView, drawSelection, hoverTooltip, keymap, lineNumbers } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { autocompletion, closeBracketsKeymap, type Completion, type CompletionContext } from "@codemirror/autocomplete";
import { vim } from "@replit/codemirror-vim";
import type { PlaygroundCompletionItem, PlaygroundDefinitionLocation, PlaygroundDiagnostic, PlaygroundHover } from "./types";

export type EditorSettings = {
  tabSize: 2 | 4;
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
  source: string;
  settings: EditorSettings;
  onReady: (view: EditorView | undefined) => void;
  onDocumentChange: (source: string, path: string) => void;
  onError: (error: Error) => void;
  diagnostics?: PlaygroundDiagnostic[];
  onRun: () => void;
  onFormat: () => void;
  onComplete: (path: string, position: { line: number; character: number }) => Promise<PlaygroundCompletionItem[]>;
  onDefinition: (path: string, position: { line: number; character: number }) => Promise<PlaygroundDefinitionLocation | null>;
  onHover: (path: string, position: { line: number; character: number }) => Promise<PlaygroundHover | null>;
  onNavigate: (location: PlaygroundDefinitionLocation) => void;
};

function toEditorDiagnostics(diagnostics: PlaygroundDiagnostic[], path: string, view: EditorView): Diagnostic[] {
  const doc = view.state.doc;
  const position = (lineNumber: number, column: number) => {
    const line = doc.line(Math.max(1, Math.min(lineNumber, doc.lines)));
    return Math.min(line.to, line.from + Math.max(0, column - 1));
  };

  return diagnostics.filter((diagnostic) => (diagnostic.path ?? "main.mcl") === path).map((diagnostic) => {
    const from = position(diagnostic.line, diagnostic.column);
    const to = diagnostic.endLine === undefined || diagnostic.endColumn === undefined
      ? Math.min(doc.length, from + 1)
      : Math.max(from, position(diagnostic.endLine, diagnostic.endColumn));
    const severity: Diagnostic["severity"] = diagnostic.severity.toLowerCase() === "warning"
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

function completionType(kind: number): Completion["type"] {
  switch (kind) {
    case 2: return "method";
    case 3: return "function";
    case 5:
    case 10: return "property";
    case 6: return "variable";
    case 7: return "class";
    case 8: return "type";
    case 9: return "namespace";
    case 14: return "keyword";
    case 21: return "constant";
    default: return "text";
  }
}

function waitForCompletionDelay(context: CompletionContext, delayMs: number): Promise<boolean> {
  if (context.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    let finished = false;
    const finish = (active: boolean) => {
      if (finished) return;
      finished = true;
      window.clearTimeout(timer);
      resolve(active);
    };
    const timer = window.setTimeout(() => finish(!context.aborted), delayMs);
    context.addEventListener("abort", () => finish(false), { onDocChange: true });
  });
}

export function MclEditor({ path, source, settings, onReady, onDocumentChange, onError, diagnostics = [], onRun, onFormat, onComplete, onDefinition, onHover, onNavigate }: Props) {
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
  const vimMode = useRef(new Compartment());
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const callbacks = useRef({ onReady, onDocumentChange, onError, onRun, onFormat, onComplete, onDefinition, onHover, onNavigate });
  callbacks.current = { onReady, onDocumentChange, onError, onRun, onFormat, onComplete, onDefinition, onHover, onNavigate };

  async function goToDefinition(view: EditorView, position: number) {
    const requestId = ++definitionRequest.current;
    const requestGeneration = documentGeneration.current;
    const requestPath = currentPath.current;
    const requestDocument = view.state.doc;
    const line = view.state.doc.lineAt(position);
    try {
      const location = await callbacks.current.onDefinition(requestPath, {
        line: line.number - 1,
        character: position - line.from,
      });
      if (definitionRequest.current !== requestId || documentGeneration.current !== requestGeneration || viewRef.current !== view || currentPath.current !== requestPath || view.state.doc !== requestDocument) return;
      if (location) callbacks.current.onNavigate(location);
    } catch (cause) {
      if (definitionRequest.current !== requestId || documentGeneration.current !== requestGeneration || viewRef.current !== view || currentPath.current !== requestPath || view.state.doc !== requestDocument) return;
      callbacks.current.onError(cause instanceof Error ? cause : new Error(String(cause)));
    }
  }

  function settingsEffects(next: EditorSettings) {
    return [
      gutter.current.reconfigure(next.lineNumbers ? lineNumbers() : []),
      wrapping.current.reconfigure(next.lineWrapping ? EditorView.lineWrapping : []),
      indentation.current.reconfigure([
        EditorState.tabSize.of(next.tabSize),
        indentUnit.of(" ".repeat(next.tabSize)),
      ]),
      vimMode.current.reconfigure(next.vim ? vim() : []),
    ];
  }

  useEffect(() => {
    if (!host.current) return;
    let view: EditorView | undefined;
    try {
      extensions.current = [
        vimMode.current.of(settingsRef.current.vim ? vim() : []),
        gutter.current.of(settingsRef.current.lineNumbers ? lineNumbers() : []),
        wrapping.current.of(settingsRef.current.lineWrapping ? EditorView.lineWrapping : []),
        indentation.current.of([
          EditorState.tabSize.of(settingsRef.current.tabSize),
          indentUnit.of(" ".repeat(settingsRef.current.tabSize)),
        ]),
        drawSelection(),
        EditorView.contentAttributes.of({ "aria-label": "MCLソース" }),
        history(),
        bracketMatching(),
        foldGutter(),
        mclLanguageSupport(),
        lintGutter(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        autocompletion({
          override: [async (context) => {
            const word = context.matchBefore(/[\w.-]*/);
            if (!context.explicit && (!word || word.from === word.to)) return null;
            if (!await waitForCompletionDelay(context, 120)) return null;
            const line = context.state.doc.lineAt(context.pos);
            const items = await callbacks.current.onComplete(currentPath.current, {
              line: line.number - 1,
              character: context.pos - line.from,
            });
            if (context.aborted || items.length === 0) return null;
            const from = word?.from ?? context.pos;
            const options: Completion[] = items.map((item) => ({
              label: item.label,
              type: completionType(item.kind),
              ...(item.insertText === undefined ? {} : { apply: item.insertText }),
            }));
            return { from, options };
          }],
        }),
        hoverTooltip(async (view, position) => {
          const requestId = ++hoverRequest.current;
          const requestGeneration = documentGeneration.current;
          const requestPath = currentPath.current;
          const requestDocument = view.state.doc;
          const line = view.state.doc.lineAt(position);
          try {
            const hover = await callbacks.current.onHover(requestPath, {
              line: line.number - 1,
              character: position - line.from,
            });
            if (hoverRequest.current !== requestId || documentGeneration.current !== requestGeneration || viewRef.current !== view || currentPath.current !== requestPath || view.state.doc !== requestDocument) return null;
            if (!hover) return null;
            const fromLine = view.state.doc.line(Math.min(hover.range.start.line + 1, view.state.doc.lines));
            const toLine = view.state.doc.line(Math.min(hover.range.end.line + 1, view.state.doc.lines));
            const from = Math.min(fromLine.to, fromLine.from + hover.range.start.character);
            const to = Math.max(from, Math.min(toLine.to, toLine.from + hover.range.end.character));
            return {
              pos: from,
              end: to,
              create() {
                const dom = document.createElement("div");
                dom.className = "cm-tooltip-hover";
                dom.textContent = hover.contents;
                return { dom };
              },
            };
          } catch {
            return null;
          }
        }, { hoverTime: 450, hideOnChange: true }),
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
          { key: "Mod-Enter", run: () => { callbacks.current.onRun(); return true; } },
          { key: "Shift-Alt-f", run: () => { callbacks.current.onFormat(); return true; } },
          { key: "F12", run: (view) => { void goToDefinition(view, view.state.selection.main.head); return true; } },
          ...closeBracketsKeymap,
          indentWithTab,
          ...searchKeymap,
          ...foldKeymap,
          ...defaultKeymap,
          ...historyKeymap,
        ]),
        EditorView.domEventHandlers({
          mousedown(event, view) {
            if (event.button !== 0 || !(event.metaKey || event.ctrlKey)) return false;
            const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
            if (position === null) return false;
            event.preventDefault();
            void goToDefinition(view, position);
            return true;
          },
        }),
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
    const nextState = states.current.get(path) ?? EditorState.create({ doc: source, extensions: extensions.current }).update({ effects: settingsEffects(settingsRef.current) }).state;
    states.current.set(path, nextState);
    view.setState(nextState);
    callbacks.current.onReady(view);
  }, [path, source]);

  useEffect(() => {
    const effects = settingsEffects(settings);
    for (const [statePath, state] of states.current) {
      if (statePath !== currentPath.current) states.current.set(statePath, state.update({ effects }).state);
    }
    const view = viewRef.current;
    if (view) {
      view.dispatch({ effects });
      states.current.set(currentPath.current, view.state);
    }
  }, [settings]);

  useEffect(() => {
    const view = viewRef.current;
    if (view) view.dispatch(setDiagnostics(view.state, toEditorDiagnostics(diagnostics, path, view)));
  }, [diagnostics, path]);

  return <div className="playground-editor" ref={host} />;
}
