import type { PlaygroundDiagnostic, PlaygroundReply } from "./types";

type Props = {
  reply?: PlaygroundReply;
  onDiagnostic: (diagnostic: PlaygroundDiagnostic) => void;
};

export function PlaygroundResult({ reply, onDiagnostic }: Props) {
  return (
    <>
      {reply && !reply.ok && reply.error && (
        <p role="alert">
          <button className="diagnostic" onClick={() => onDiagnostic(reply.error!)}>
            {reply.error.code}: {reply.error.message} ({reply.error.line}:{reply.error.column})
          </button>
        </p>
      )}
      {reply?.diagnostics && reply.diagnostics.length > 0 && (
        <ul className="playground-diagnostics">
          {reply.diagnostics.map((diagnostic, index) => (
            <li key={`${diagnostic.code}-${diagnostic.line}-${index}`}>
              <button className="diagnostic" onClick={() => onDiagnostic(diagnostic)}>
                {diagnostic.severity}: {diagnostic.message} ({diagnostic.line}:{diagnostic.column})
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
