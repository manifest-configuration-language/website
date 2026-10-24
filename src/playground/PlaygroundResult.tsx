import { useEffect, useRef } from "react";
import { MergeView } from "@codemirror/merge";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { yaml } from "@codemirror/lang-yaml";
import { foldGutter, foldKeymap } from "@codemirror/language";
import { openSearchPanel, searchKeymap } from "@codemirror/search";
import { keymap } from "@codemirror/view";
import { parseAllDocuments } from "yaml";
import type { PlaygroundDiagnostic, PlaygroundReply, PlaygroundSourceMap } from "./types";

type Props = {
  reply?: PlaygroundReply;
  navigablePaths: string[];
  staleYaml?: string;
  previousYaml?: string;
  fontSize: number;
  showDiff: boolean;
  showProblems: boolean;
  targetOutputPosition?: { line: number; character: number; requestId: number };
  onDiagnostic: (diagnostic: PlaygroundDiagnostic) => void;
  onSourceLocation: (path: string, line: number, character: number) => void;
};

export function PlaygroundResult({
  reply,
  navigablePaths,
  staleYaml,
  previousYaml,
  fontSize,
  showDiff,
  showProblems,
  targetOutputPosition,
  onDiagnostic,
  onSourceLocation,
}: Props) {
  const diffHost = useRef<HTMLDivElement>(null);
  const outputHost = useRef<HTMLDivElement>(null);
  const outputEditor = useRef<EditorView | undefined>(undefined);
  const onSourceLocationRef = useRef(onSourceLocation);
  onSourceLocationRef.current = onSourceLocation;
  const currentYaml = reply?.ok ? reply.result?.yaml : undefined;
  const sourceMap = staleYaml === undefined && reply?.ok ? reply.result?.sourceMap : undefined;
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
          ...(sourceMap?.complete
            ? [
                EditorView.domEventHandlers({
                  click(event, editor) {
                    const offset = editor.posAtCoords({ x: event.clientX, y: event.clientY });
                    if (offset === null) return false;
                    const source = sourceForOutputPosition(editor, sourceMap, offset);
                    if (!source) return false;
                    onSourceLocationRef.current(source.path, source.line, source.character);
                    return true;
                  },
                }),
              ]
            : []),
        ],
      }),
    });
    outputEditor.current = view;
    return () => {
      outputEditor.current = undefined;
      view.destroy();
    };
  }, [fontSize, staleYaml, currentYaml, sourceMap, showProblems, showDiff]);

  useEffect(() => {
    const view = outputEditor.current;
    if (
      !view ||
      !targetOutputPosition ||
      staleYaml !== undefined ||
      !reply?.ok ||
      targetOutputPosition.requestId !== reply.requestId
    )
      return;
    const offset = positionOffset(view, targetOutputPosition.line, targetOutputPosition.character);
    if (offset === undefined) return;
    view.dispatch({ selection: { anchor: offset }, scrollIntoView: true });
    view.focus();
  }, [targetOutputPosition, staleYaml, reply, showProblems, showDiff]);

  function goToDocument(line: number) {
    const view = outputEditor.current;
    if (!view) return;
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
    return !diagnostic.path || navigablePaths.includes(diagnostic.path);
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

function sourceForOutputPosition(
  editor: EditorView,
  sourceMap: PlaygroundSourceMap,
  offset: number,
): { path: string; line: number; character: number } | undefined {
  const candidates = sourceMap.entries.flatMap((entry) => {
    const start = positionOffset(editor, entry.output.start.line, entry.output.start.character);
    const end = positionOffset(editor, entry.output.end.line, entry.output.end.character);
    if (start === undefined || end === undefined || offset < start || offset >= end) return [];
    return [{ entry, start, end }];
  });
  if (candidates.length === 0) return undefined;

  const shortest = Math.min(...candidates.map(({ start, end }) => end - start));
  const mostSpecific = candidates.filter(({ start, end }) => end - start === shortest);
  if (mostSpecific.length !== 1) return undefined;

  const sources = mostSpecific[0].entry.sources;
  if (sources.length !== 1) return undefined;
  const [source] = sources;
  if (source.kind !== "mcl" || source.multiplicity !== "unique" || source.occurrences !== 1)
    return undefined;
  return {
    path: source.path,
    line: source.range.start.line,
    character: source.range.start.character,
  };
}

function positionOffset(editor: EditorView, line: number, character: number): number | undefined {
  if (!Number.isInteger(line) || !Number.isInteger(character) || line < 0 || character < 0)
    return undefined;
  if (line >= editor.state.doc.lines) return undefined;
  const docLine = editor.state.doc.line(line + 1);
  if (character > docLine.length) return undefined;
  return docLine.from + character;
}

function YamlNavigation({ text, onSelect }: { text: string; onSelect: (line: number) => void }) {
  let documents;
  try {
    documents = parseAllDocuments(text, {
      schema: "core",
      stringKeys: true,
      uniqueKeys: true,
    });
  } catch {
    return null;
  }

  const resources = documents.flatMap((document, index) => {
    if (document.errors.length > 0 || document.contents === null) return [];

    const kind = document.get("kind");
    const name = document.getIn(["metadata", "name"]);
    const label =
      typeof kind === "string" && kind.length > 0
        ? typeof name === "string" && name.length > 0
          ? `${kind}/${name}`
          : kind
        : `文書${index + 1}`;
    const start = document.range?.[0] ?? 0;
    const line = text.slice(0, start).split("\n").length - 1;

    return [{ label, line }];
  });

  if (resources.length < 2) return null;
  return (
    <nav className="yaml-document-nav" aria-label="YAML文書">
      {resources.map(({ label, line }, index) => (
        <button type="button" key={`${line}-${index}`} onClick={() => onSelect(line)}>
          {label}
        </button>
      ))}
    </nav>
  );
}
