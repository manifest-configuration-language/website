import { useEffect, useRef } from "react";
import { MergeView } from "@codemirror/merge";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { yaml } from "@codemirror/lang-yaml";
import { foldGutter, foldKeymap } from "@codemirror/language";
import { openSearchPanel, searchKeymap } from "@codemirror/search";
import { keymap } from "@codemirror/view";
import type { PlaygroundDiagnostic, PlaygroundReply } from "./types";

type Props = {
  reply?: PlaygroundReply;
  staleYaml?: string;
  previousYaml?: string;
  fontSize: number;
  showDiff: boolean;
  showProblems: boolean;
  onDiagnostic: (diagnostic: PlaygroundDiagnostic) => void;
};

export function PlaygroundResult({
  reply,
  staleYaml,
  previousYaml,
  fontSize,
  showDiff,
  showProblems,
  onDiagnostic,
}: Props) {
  const diffHost = useRef<HTMLDivElement>(null);
  const outputHost = useRef<HTMLDivElement>(null);
  const outputEditor = useRef<EditorView | undefined>(undefined);
  const currentYaml = reply?.ok ? reply.result?.yaml : undefined;
  const canShowDiff =
    previousYaml !== undefined && currentYaml !== undefined && previousYaml !== currentYaml;

  useEffect(() => {
    const parent = outputHost.current;
    const text = staleYaml ?? currentYaml;
    if (!parent || text === undefined || showProblems || showDiff) return;
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: text,
        extensions: [
          yaml(),
          foldGutter(),
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          EditorView.lineWrapping,
          EditorView.theme({ ".cm-content, .cm-gutters": { fontSize: `${fontSize}px` } }),
          keymap.of([...searchKeymap, ...foldKeymap]),
          EditorView.contentAttributes.of({ "aria-label": "YAML結果" }),
        ],
      }),
    });
    outputEditor.current = view;
    return () => {
      outputEditor.current = undefined;
      view.destroy();
    };
  }, [fontSize, staleYaml, currentYaml, showProblems, showDiff]);

  function goToDocument(index: number) {
    const view = outputEditor.current;
    if (!view) return;
    const lines = (staleYaml ?? currentYaml ?? "").split("\n");
    const starts = [
      0,
      ...lines.flatMap((line, lineIndex) =>
        line.trim() === "---" && lineIndex > 0 ? [lineIndex] : [],
      ),
    ];
    const line = starts[index] ?? 0;
    view.dispatch({
      selection: { anchor: view.state.doc.line(Math.min(line + 1, view.state.doc.lines)).from },
      scrollIntoView: true,
    });
    view.focus();
  }

  useEffect(() => {
    const parent = diffHost.current;
    if (
      !parent ||
      !showDiff ||
      !canShowDiff ||
      previousYaml === undefined ||
      currentYaml === undefined
    )
      return;
    const readOnly = [
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
      EditorView.lineWrapping,
      EditorView.theme({ ".cm-content, .cm-gutters": { fontSize: `${fontSize}px` } }),
    ];
    const merge = new MergeView({
      a: { doc: previousYaml, extensions: readOnly },
      b: { doc: currentYaml, extensions: readOnly },
      parent,
      gutter: true,
      highlightChanges: true,
    });
    return () => merge.destroy();
  }, [canShowDiff, currentYaml, fontSize, previousYaml, showDiff]);

  function location(diagnostic: PlaygroundDiagnostic) {
    return `${diagnostic.path ? `${diagnostic.path}:` : ""}${diagnostic.line}:${diagnostic.column}`;
  }

  function canNavigate(diagnostic: PlaygroundDiagnostic) {
    return !diagnostic.path || diagnostic.path.endsWith(".mcl");
  }

  return (
    <>
      {showProblems && reply && !reply.ok && reply.error && (
        <p role="alert">
          <button
            className="diagnostic"
            disabled={!canNavigate(reply.error)}
            onClick={() => onDiagnostic(reply.error!)}
          >
            {reply.error.code}: {reply.error.message} ({location(reply.error)})
          </button>
        </p>
      )}
      {showProblems && reply?.diagnostics && reply.diagnostics.length > 0 && (
        <ul className="playground-diagnostics">
          {reply.diagnostics.map((diagnostic, index) => (
            <li key={`${diagnostic.code}-${diagnostic.line}-${index}`}>
              <button
                className="diagnostic"
                disabled={!canNavigate(diagnostic)}
                onClick={() => onDiagnostic(diagnostic)}
              >
                {diagnostic.severity}: {diagnostic.message} ({location(diagnostic)})
              </button>
            </li>
          ))}
        </ul>
      )}
      {!showProblems && !showDiff && staleYaml !== undefined && (
        <section aria-label="前回の結果">
          <p>前回の結果</p>
          <div className="playground-yaml-toolbar">
            <span>前回のYAML</span>
            <button
              type="button"
              onClick={() => outputEditor.current && openSearchPanel(outputEditor.current)}
            >
              検索
            </button>
          </div>
          <YamlNavigation text={staleYaml} onSelect={goToDocument} />
          <div className="playground-output" aria-label="前回のYAML結果" ref={outputHost} />
        </section>
      )}
      {!showProblems && !showDiff && reply?.ok && (
        <>
          <div className="playground-yaml-toolbar">
            <span>生成されたYAML</span>
            <button
              type="button"
              onClick={() => outputEditor.current && openSearchPanel(outputEditor.current)}
            >
              検索
            </button>
          </div>
          <YamlNavigation text={currentYaml ?? ""} onSelect={goToDocument} />
          <div className="playground-output" aria-label="レンダリング結果" ref={outputHost} />
        </>
      )}
      {!showProblems && showDiff && canShowDiff && (
        <section className="playground-diff" aria-label="YAML差分">
          <div className="playground-diff-labels">
            <span>前回</span>
            <span>最新</span>
          </div>
          <div className="playground-diff-editor" ref={diffHost} />
        </section>
      )}
    </>
  );
}

function YamlNavigation({ text, onSelect }: { text: string; onSelect: (index: number) => void }) {
  const documents = text.split(/^---\s*$/m).filter((document) => document.trim().length > 0);
  if (documents.length < 2) return null;
  return (
    <nav className="yaml-document-nav" aria-label="YAML文書">
      {documents.map((document, index) => {
        const kind = document.match(/^kind:\s*["']?([^\n"']+)/m)?.[1]?.trim() ?? `文書${index + 1}`;
        const name = document.match(/^\s+name:\s*["']?([^\n"']+)/m)?.[1]?.trim();
        return (
          <button type="button" key={index} onClick={() => onSelect(index)}>
            {name ? `${kind}/${name}` : kind}
          </button>
        );
      })}
    </nav>
  );
}
