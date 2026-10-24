import { useEffect, useMemo, useRef, useState } from "react";
import { MergeView } from "@codemirror/merge";
import { EditorState, RangeSetBuilder, Text } from "@codemirror/state";
import { Decoration, EditorView, hoverTooltip } from "@codemirror/view";
import { yaml } from "@codemirror/lang-yaml";
import { foldGutter, foldKeymap } from "@codemirror/language";
import { openSearchPanel, searchKeymap } from "@codemirror/search";
import { keymap } from "@codemirror/view";
import { Command } from "cmdk";
import { parseAllDocuments } from "yaml";
import type { PlaygroundDiagnostic, PlaygroundReply, PlaygroundSourceMap } from "./types";

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
  const diffHost = useRef<HTMLDivElement>(null);
  const outputHost = useRef<HTMLDivElement>(null);
  const outputEditor = useRef<EditorView | undefined>(undefined);
  const onSourceLocationRef = useRef(onSourceLocation);
  onSourceLocationRef.current = onSourceLocation;
  const currentYaml = reply?.ok ? reply.result?.yaml : undefined;
  const sourceMap = staleYaml === undefined && reply?.ok ? reply.result?.sourceMap : undefined;
  const [showResources, setShowResources] = useState(false);
  const [selectedResourceKey, setSelectedResourceKey] = useState<string>();
  const displayedYaml = staleYaml ?? currentYaml;
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
          ...(!selectedResource && sourceMap
            ? [
                EditorView.decorations.of(
                  sourceMapDecorations(Text.of(text.split("\n")), sourceMap, navigablePaths),
                ),
                hoverTooltip((editor, position) => {
                  const source = sourceForOutputPosition(editor, sourceMap, position);
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
  }, [
    displayedYaml,
    fontSize,
    navigablePaths,
    selectedResource,
    sourceMap,
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
    const offset = positionOffset(
      view.state.doc,
      targetOutputPosition.line,
      targetOutputPosition.character,
    );
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

  function selectResource(resource: YamlResource) {
    setSelectedResourceKey(resource.key);
    setShowResources(false);
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
    const previousText = selectedDiffResource
      ? (selectedDiffResource.previous?.yaml ?? "")
      : previousYaml;
    const currentText = selectedDiffResource
      ? (selectedDiffResource.current?.yaml ?? "")
      : currentYaml;
    const merge = new MergeView({
      a: { doc: previousText, extensions: readOnly },
      b: { doc: currentText, extensions: readOnly },
      parent,
      gutter: true,
      highlightChanges: true,
    });
    return () => merge.destroy();
  }, [canShowDiff, currentYaml, fontSize, previousYaml, selectedDiffResource, showDiff]);

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
      {!showProblems && !showDiff && staleYaml !== undefined && (
        <section className="playground-result-content" aria-label="前回の結果">
          <div className="playground-yaml-toolbar">
            <span>前回の結果</span>
            <span className="playground-result-stale">古い結果</span>
            {selectedResource && (
              <button
                type="button"
                className="playground-resource-clear"
                onClick={() => setSelectedResourceKey(undefined)}
              >
                すべて
              </button>
            )}
            <button
              type="button"
              className="playground-resource-toggle"
              aria-pressed={showResources}
              onClick={() => setShowResources((shown) => !shown)}
              disabled={resources.length === 0}
            >
              {selectedResource?.label ?? "リソース"}
            </button>
            <button
              type="button"
              onClick={() => outputEditor.current && openSearchPanel(outputEditor.current)}
            >
              検索
            </button>
          </div>
          <ResourceBrowser
            resources={resources}
            onSelect={selectResource}
            hidden={!showResources}
          />
          {!selectedResource && (
            <YamlNavigation text={staleYaml} onSelect={goToDocument} hidden={showResources} />
          )}
          <div
            className="playground-output"
            aria-label={selectedResource ? `${selectedResource.label}のYAML結果` : "前回のYAML結果"}
            hidden={showResources}
            ref={outputHost}
          />
        </section>
      )}
      {!showProblems && !showDiff && staleYaml === undefined && reply?.ok && (
        <section className="playground-result-content" aria-label="YAML出力">
          <div className="playground-yaml-toolbar">
            <span>YAML</span>
            <span className="playground-result-status">最新</span>
            {selectedResource && (
              <button
                type="button"
                className="playground-resource-clear"
                onClick={() => setSelectedResourceKey(undefined)}
              >
                すべて
              </button>
            )}
            <button
              type="button"
              className="playground-resource-toggle"
              aria-pressed={showResources}
              onClick={() => setShowResources((shown) => !shown)}
              disabled={resources.length === 0}
            >
              {selectedResource?.label ?? "リソース"}
            </button>
            <button
              type="button"
              onClick={() => outputEditor.current && openSearchPanel(outputEditor.current)}
            >
              検索
            </button>
          </div>
          <ResourceBrowser
            resources={resources}
            onSelect={selectResource}
            hidden={!showResources}
          />
          {!selectedResource && (
            <YamlNavigation
              text={currentYaml ?? ""}
              onSelect={goToDocument}
              hidden={showResources}
            />
          )}
          <div
            className="playground-output"
            aria-label={
              selectedResource ? `${selectedResource.label}のYAML結果` : "レンダリング結果"
            }
            hidden={showResources}
            ref={outputHost}
          />
        </section>
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
        <section className="playground-diff" aria-label="YAML差分">
          <div className="playground-diff-labels">
            <span>
              {selectedDiffResource ? (selectedDiffResource.previous ? "前回" : "追加") : "前回"}
            </span>
            <div className="playground-diff-resource-controls">
              <button
                type="button"
                className="playground-diff-resource-toggle"
                aria-pressed={showResources}
                onClick={() => setShowResources((shown) => !shown)}
                disabled={diffResources.length === 0}
              >
                {selectedDiffResource?.label ?? "全体"}
              </button>
              {selectedDiffResource && (
                <button
                  type="button"
                  className="playground-diff-resource-reset"
                  onClick={() => {
                    setSelectedResourceKey(undefined);
                    setShowResources(false);
                  }}
                >
                  全体
                </button>
              )}
            </div>
            <span>
              {selectedDiffResource ? (selectedDiffResource.current ? "最新" : "削除") : "最新"}
            </span>
          </div>
          <ResourceBrowser
            resources={diffResources}
            onSelect={selectResource}
            hidden={!showResources}
            showChanges
          />
          <div className="playground-diff-editor" ref={diffHost} hidden={showResources} />
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
    const start = positionOffset(
      editor.state.doc,
      entry.output.start.line,
      entry.output.start.character,
    );
    const end = positionOffset(editor.state.doc, entry.output.end.line, entry.output.end.character);
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
      const from = positionOffset(document, entry.output.start.line, entry.output.start.character);
      const to = positionOffset(document, entry.output.end.line, entry.output.end.character);
      return from !== undefined && to !== undefined && to > from ? [{ from, to }] : [];
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

type YamlResource = {
  key: string;
  label: string;
  apiVersion?: string;
  namespace?: string;
  line: number;
  yaml: string;
  previous?: YamlResource;
  current?: YamlResource;
};

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
    const line = text.slice(0, start).split("\n").length - 1;
    const yaml = text.slice(start, end).trim();

    return [
      {
        key: `${identity}#${occurrence}`,
        label,
        apiVersion: typeof apiVersion === "string" ? apiVersion : undefined,
        namespace: typeof namespace === "string" ? namespace : undefined,
        line,
        yaml: yaml ? `${yaml}\n` : "",
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

function ResourceBrowser({
  resources,
  onSelect,
  hidden,
  showChanges = false,
}: {
  resources: YamlResource[];
  onSelect: (resource: YamlResource) => void;
  hidden: boolean;
  showChanges?: boolean;
}) {
  return (
    <div className="playground-resource-browser" hidden={hidden}>
      <Command label="リソース検索" loop>
        <Command.Input aria-label="リソース検索" placeholder="リソースを検索" />
        <Command.List>
          <Command.Empty>一致するリソースはありません</Command.Empty>
          {resources.map((resource) => (
            <Command.Item
              key={resource.key}
              value={resource.label}
              keywords={[resource.apiVersion, resource.namespace].filter((value): value is string =>
                Boolean(value),
              )}
              onSelect={() => onSelect(resource)}
            >
              <span className="playground-resource-name">{resource.label}</span>
              <span className="playground-resource-details">
                {showChanges
                  ? resource.previous && resource.current
                    ? resource.previous.yaml === resource.current.yaml
                      ? "変更なし"
                      : "変更"
                    : resource.current
                      ? "追加"
                      : "削除"
                  : [resource.apiVersion, resource.namespace].filter(Boolean).join(" · ")}
              </span>
            </Command.Item>
          ))}
        </Command.List>
      </Command>
    </div>
  );
}

function YamlNavigation({
  text,
  onSelect,
  hidden,
}: {
  text: string;
  onSelect: (line: number) => void;
  hidden: boolean;
}) {
  const resources = parseYamlResources(text);
  if (resources.length < 2) return null;
  return (
    <nav className="yaml-document-nav" aria-label="YAML文書" hidden={hidden}>
      {resources.map((resource) => (
        <button type="button" key={resource.key} onClick={() => onSelect(resource.line)}>
          {resource.label}
        </button>
      ))}
    </nav>
  );
}
