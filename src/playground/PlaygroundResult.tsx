import type { PlaygroundDiagnostic, PlaygroundReply } from "./types";

type Props = {
  reply?: PlaygroundReply;
  onDiagnostic: (diagnostic: PlaygroundDiagnostic) => void;
};

export function PlaygroundResult({ reply, onDiagnostic }: Props) {
  function location(diagnostic: PlaygroundDiagnostic) {
    return `${diagnostic.path ? `${diagnostic.path}:` : ""}${diagnostic.line}:${diagnostic.column}`;
  }

  function canNavigate(diagnostic: PlaygroundDiagnostic) {
    return diagnostic.path === "main.mcl";
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
          <code>{reply.result?.yaml}</code>
        </pre>
      )}
    </>
  );
}
