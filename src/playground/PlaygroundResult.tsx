import { useEffect, useRef } from "react";
import { MergeView } from "@codemirror/merge";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { PlaygroundDiagnostic, PlaygroundReply } from "./types";

type Props = {
  reply?: PlaygroundReply;
  previousYaml?: string;
  showDiff: boolean;
  onDiagnostic: (diagnostic: PlaygroundDiagnostic) => void;
};

export function PlaygroundResult({ reply, previousYaml, showDiff, onDiagnostic }: Props) {
  const diffHost = useRef<HTMLDivElement>(null);
  const currentYaml = reply?.ok ? reply.result?.yaml : undefined;
  const canShowDiff = previousYaml !== undefined && currentYaml !== undefined && previousYaml !== currentYaml;

  useEffect(() => {
    const parent = diffHost.current;
    if (!parent || !showDiff || !canShowDiff || previousYaml === undefined || currentYaml === undefined) return;
    const readOnly = [EditorState.readOnly.of(true), EditorView.editable.of(false), EditorView.lineWrapping];
    const merge = new MergeView({
      a: { doc: previousYaml, extensions: readOnly },
      b: { doc: currentYaml, extensions: readOnly },
      parent,
      gutter: true,
      highlightChanges: true,
    });
    return () => merge.destroy();
  }, [canShowDiff, currentYaml, previousYaml, showDiff]);

  function location(diagnostic: PlaygroundDiagnostic) {
    return `${diagnostic.path ? `${diagnostic.path}:` : ""}${diagnostic.line}:${diagnostic.column}`;
  }

  function canNavigate(diagnostic: PlaygroundDiagnostic) {
    return !diagnostic.path || diagnostic.path.endsWith(".mcl");
  }

  return (
    <>
      {reply && !reply.ok && reply.error && (
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
      {reply?.diagnostics && reply.diagnostics.length > 0 && (
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
      {reply?.ok && (
        <pre className="playground-output" aria-label="レンダリング結果">
          <code>{currentYaml}</code>
        </pre>
      )}
      {showDiff && canShowDiff && (
        <section className="playground-diff" aria-label="YAML差分">
          <div className="playground-diff-labels"><span>前回</span><span>最新</span></div>
          <div className="playground-diff-editor" ref={diffHost} />
        </section>
      )}
    </>
  );
}
