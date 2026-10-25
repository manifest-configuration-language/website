import { useEffect, useMemo, useRef, useState } from "react";
import { EditorState, RangeSetBuilder, Text } from "@codemirror/state";
import { Decoration, EditorView, hoverTooltip } from "@codemirror/view";
import { yaml } from "@codemirror/lang-yaml";
import { foldGutter, foldKeymap } from "@codemirror/language";
import { openSearchPanel, searchKeymap } from "@codemirror/search";
import { keymap } from "@codemirror/view";
import { parseAllDocuments } from "yaml";
import type { PlaygroundDiagnostic, PlaygroundReply, PlaygroundSourceMap } from "./types";
import { PlaygroundYamlResultView, type YamlResource } from "./PlaygroundYamlResultView";
import { PlaygroundDiffResultView } from "./PlaygroundDiffResultView";

type Props = {
  reply?: PlaygroundReply;
  diagnostics: PlaygroundDiagnostic[];
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
  diagnostics,
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
  const outputHost = useRef<HTMLDivElement>(null);
  const outputEditor = useRef<EditorView | undefined>(undefined);
  const onSourceLocationRef = useRef(onSourceLocation);
  onSourceLocationRef.current = onSourceLocation;
  const currentYaml = reply?.ok ? reply.result?.yaml : undefined;
  const sourceMap = staleYaml === undefined && reply?.ok ? reply.result?.sourceMap : undefined;
  const [showResources, setShowResources] = useState(false);
  const [selectedResourceKey, setSelectedResourceKey] = useState<string>();
  const displayedYaml = staleYaml ?? currentYaml;
  const sourceMapDocument = useMemo(
    () => (displayedYaml === undefined ? undefined : Text.of(displayedYaml.split("\n"))),
    [displayedYaml],
  );
  const resources = useMemo(() => parseYamlResources(displayedYaml ?? ""), [displayedYaml]);
  const previousResources = useMemo(() => parseYamlResources(previousYaml ?? ""), [previousYaml]);
  const currentResources = useMemo(() => parseYamlResources(currentYaml ?? ""), [currentYaml]);
  const diffResources = useMemo(
    () => mergeResourceLists(previousResources, currentResources),
    [currentResources, previousResources],
  );
  const selectedResource = resources.find((resource) => resource.key === selectedResourceKey);
  const selectedDiffResource = diffResources.find(
    (resource) => resource.key === selectedResourceKey,
  );
  const canShowDiff =
    previousYaml !== undefined && currentYaml !== undefined && previousYaml !== currentYaml;

  useEffect(() => {
    setShowResources(false);
    setSelectedResourceKey(undefined);
  }, [currentYaml, staleYaml]);

  useEffect(() => {
    if (
      !showDiff &&
      selectedResourceKey &&
      !resources.some((resource) => resource.key === selectedResourceKey)
    )
      setSelectedResourceKey(undefined);
  }, [resources, selectedResourceKey, showDiff]);

  useEffect(() => {
    const parent = outputHost.current;
    const text = selectedResource?.yaml ?? displayedYaml;
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
          ...(sourceMap && sourceMapDocument
            ? [
                EditorView.decorations.of(
                  sourceMapDecorations(
                    Text.of(text.split("\n")),
                    sourceMap,
                    navigablePaths,
                    sourceMapDocument,
                    selectedResource,
                  ),
                ),
                hoverTooltip((editor, position) => {
                  const source = sourceForOutputPosition(
                    sourceMapDocument,
                    sourceMap,
                    selectedResource ? selectedResource.outputStartOffset + position : position,
                  );
                  if (!source || !navigablePaths.includes(source.path)) return null;
                  return {
                    pos: position,
                    end: Math.min(position + 1, editor.state.doc.length),
                    create() {
                      const dom = document.createElement("div");
                      dom.className = "cm-source-map-tooltip";
                      dom.textContent = `${source.path}:${source.line + 1}:${source.character + 1}`;
                      return { dom };
                    },
                  };
                }),
                EditorView.domEventHandlers({
                  click(event, editor) {
                    const offset = editor.posAtCoords({ x: event.clientX, y: event.clientY });
                    if (offset === null) return false;
                    const source = sourceForOutputPosition(
                      sourceMapDocument,
                      sourceMap,
                      selectedResource ? selectedResource.outputStartOffset + offset : offset,
                    );
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
  }, [
    displayedYaml,
    fontSize,
    navigablePaths,
    selectedResource,
    sourceMap,
    sourceMapDocument,
    showProblems,
    showDiff,
  ]);

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
    const outputOffset = positionOffset(
      sourceMapDocument ?? view.state.doc,
      targetOutputPosition.line,
      targetOutputPosition.character,
    );
    if (outputOffset === undefined) return;
    let offset = outputOffset;
    if (selectedResource) {
      if (
        outputOffset < selectedResource.outputStartOffset ||
        outputOffset >= selectedResource.outputEndOffset
      ) {
        setSelectedResourceKey(undefined);
        return;
      }
      offset -= selectedResource.outputStartOffset;
    }
    view.dispatch({ selection: { anchor: offset }, scrollIntoView: true });
    view.focus();
  }, [
    targetOutputPosition,
    staleYaml,
    reply,
    showProblems,
    showDiff,
    selectedResource,
    sourceMapDocument,
  ]);

  function goToDocument(line: number) {
    const view = outputEditor.current;
    if (!view) return;
    view.dispatch({
      selection: { anchor: view.state.doc.line(Math.min(line + 1, view.state.doc.lines)).from },
      scrollIntoView: true,
    });
    view.focus();
  }

  function selectResource(resource: YamlResource) {
    setSelectedResourceKey(resource.key);
    setShowResources(false);
  }

  function location(diagnostic: PlaygroundDiagnostic) {
    return `${diagnostic.path ? `${diagnostic.path}:` : ""}${diagnostic.line}:${diagnostic.column}`;
  }

  function canNavigate(diagnostic: PlaygroundDiagnostic) {
    return !diagnostic.path || navigablePaths.includes(diagnostic.path);
  }

  return (
    <>
      {showProblems && reply && !reply.ok && reply.error && diagnostics.length === 0 && (
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
      {showProblems && diagnostics.length > 0 && (
        <ul className="playground-diagnostics">
          {diagnostics.map((diagnostic, index) => (
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
      {!showProblems && !showDiff && (staleYaml !== undefined || reply?.ok) && (
        <PlaygroundYamlResultView
          stale={staleYaml !== undefined}
          resources={resources}
          selectedResource={selectedResource}
          showResources={showResources}
          outputHost={outputHost}
          onToggleResources={() => setShowResources((shown) => !shown)}
          onSelectResource={selectResource}
          onClearResource={() => setSelectedResourceKey(undefined)}
          onSearch={() => outputEditor.current && openSearchPanel(outputEditor.current)}
          onGoToDocument={goToDocument}
        />
      )}
      {!showProblems &&
        !showDiff &&
        staleYaml === undefined &&
        !reply?.ok &&
        (reply?.error ? (
          <div className="playground-result-empty" role="status">
            <span className="playground-result-empty-icon" aria-hidden="true">
              !
            </span>
            <span>{reply.error.message}</span>
          </div>
        ) : (
          <div className="playground-result-empty" role="status">
            <span className="playground-result-empty-icon" aria-hidden="true">
              ▷
            </span>
            <span>実行結果はここに表示されます</span>
          </div>
        ))}
      {!showProblems && showDiff && canShowDiff && (
        <PlaygroundDiffResultView
          previousYaml={previousYaml!}
          currentYaml={currentYaml!}
          fontSize={fontSize}
          resources={diffResources}
          selectedResource={selectedDiffResource}
          showResources={showResources}
          onToggleResources={() => setShowResources((shown) => !shown)}
          onSelectResource={selectResource}
          onResetResource={() => {
            setSelectedResourceKey(undefined);
            setShowResources(false);
          }}
        />
      )}
    </>
  );
}

function sourceForOutputPosition(
  document: Text,
  sourceMap: PlaygroundSourceMap,
  offset: number,
): { path: string; line: number; character: number } | undefined {
  const candidates = sourceMap.entries.flatMap((entry) => {
    const start = positionOffset(document, entry.output.start.line, entry.output.start.character);
    const end = positionOffset(document, entry.output.end.line, entry.output.end.character);
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

function sourceMapDecorations(
  document: Text,
  sourceMap: PlaygroundSourceMap,
  navigablePaths: string[],
  fullDocument: Text,
  resource?: YamlResource,
) {
  const builder = new RangeSetBuilder<Decoration>();
  const ranges = sourceMap.entries
    .flatMap((entry) => {
      if (
        entry.sources.length !== 1 ||
        entry.sources[0].kind !== "mcl" ||
        entry.sources[0].multiplicity !== "unique" ||
        entry.sources[0].occurrences !== 1 ||
        !navigablePaths.includes(entry.sources[0].path)
      )
        return [];
      const fullFrom = positionOffset(
        fullDocument,
        entry.output.start.line,
        entry.output.start.character,
      );
      const fullTo = positionOffset(
        fullDocument,
        entry.output.end.line,
        entry.output.end.character,
      );
      if (fullFrom === undefined || fullTo === undefined || fullTo <= fullFrom) return [];
      if (resource && (fullFrom < resource.outputStartOffset || fullTo > resource.outputEndOffset))
        return [];
      const from = resource ? fullFrom - resource.outputStartOffset : fullFrom;
      const to = resource ? fullTo - resource.outputStartOffset : fullTo;
      return from >= 0 && to <= document.length && to > from ? [{ from, to }] : [];
    })
    .sort((left, right) => left.from - right.from || left.to - right.to);
  for (const range of ranges)
    builder.add(range.from, range.to, Decoration.mark({ class: "cm-source-map-link" }));
  return builder.finish();
}

function positionOffset(document: Text, line: number, character: number): number | undefined {
  if (!Number.isInteger(line) || !Number.isInteger(character) || line < 0 || character < 0)
    return undefined;
  if (line >= document.lines) return undefined;
  const docLine = document.line(line + 1);
  if (character > docLine.length) return undefined;
  return docLine.from + character;
}

function parseYamlResources(text: string): YamlResource[] {
  let documents;
  try {
    documents = parseAllDocuments(text, {
      schema: "core",
      stringKeys: true,
      uniqueKeys: true,
    });
  } catch {
    return [];
  }

  const occurrences = new Map<string, number>();
  return documents.flatMap((document, index) => {
    if (document.errors.length > 0 || document.contents === null) return [];

    const kind = document.get("kind");
    const name = document.getIn(["metadata", "name"]);
    const apiVersion = document.get("apiVersion");
    const namespace = document.getIn(["metadata", "namespace"]);
    const identity =
      typeof kind === "string" && typeof name === "string"
        ? JSON.stringify([apiVersion ?? "", kind, namespace ?? "", name])
        : `document:${index}`;
    const occurrence = occurrences.get(identity) ?? 0;
    occurrences.set(identity, occurrence + 1);
    const label =
      typeof kind === "string" && kind.length > 0
        ? typeof name === "string" && name.length > 0
          ? `${kind}/${name}`
          : kind
        : `文書${index + 1}`;
    const start = document.range?.[0] ?? 0;
    const end = document.range?.[1] ?? text.length;
    const rawYaml = text.slice(start, end);
    const outputStartOffset = start + rawYaml.length - rawYaml.trimStart().length;
    const outputEndOffset = Math.max(
      outputStartOffset,
      end - (rawYaml.length - rawYaml.trimEnd().length),
    );
    const line = text.slice(0, start).split("\n").length - 1;
    const yaml = text.slice(outputStartOffset, outputEndOffset);

    return [
      {
        key: `${identity}#${occurrence}`,
        label,
        apiVersion: typeof apiVersion === "string" ? apiVersion : undefined,
        namespace: typeof namespace === "string" ? namespace : undefined,
        line,
        yaml: yaml ? `${yaml}\n` : "",
        outputStartOffset,
        outputEndOffset,
      },
    ];
  });
}

function mergeResourceLists(previous: YamlResource[], current: YamlResource[]): YamlResource[] {
  const previousByKey = new Map(previous.map((resource) => [resource.key, resource]));
  const currentByKey = new Map(current.map((resource) => [resource.key, resource]));
  const keys = previous.map((resource) => resource.key);
  for (const resource of current) if (!previousByKey.has(resource.key)) keys.push(resource.key);

  return keys.flatMap((key) => {
    const before = previousByKey.get(key);
    const after = currentByKey.get(key);
    const resource = after ?? before;
    return resource ? [{ ...resource, previous: before, current: after }] : [];
  });
}
