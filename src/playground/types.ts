export type PlaygroundDiagnostic = {
  code: string;
  message: string;
  severity: "error" | "warning";
  line: number;
  column: number;
};

export type PlaygroundRequest = {
  requestId: number;
  revision: number;
  operation: "parse" | "lint" | "evaluate" | "render" | "format";
  source: string;
  files?: Record<string, ProjectFile>;
};

export type ProjectFile = { encoding: "utf8" | "base64"; content: string };

export type PlaygroundReply = {
  requestId: number;
  revision: number;
  ok: boolean;
  diagnostics?: PlaygroundDiagnostic[];
  result?: {
    yaml?: string;
    source?: string;
    artifacts?: unknown[];
    renderedBytes?: number;
    diagnostics?: PlaygroundDiagnostic[];
  };
  error?: PlaygroundDiagnostic;
};

export interface PlaygroundClient {
  run(
    source: string,
    revision: number,
    files?: Record<string, ProjectFile>,
  ): Promise<PlaygroundReply>;
  format(
    source: string,
    revision: number,
    files?: Record<string, ProjectFile>,
  ): Promise<PlaygroundReply>;
  cancel(): void;
  dispose(): void;
}
