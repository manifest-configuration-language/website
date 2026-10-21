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

export type PlaygroundFileMetadata = { encoding: "utf8"; content: string } | { encoding: "binary" };

export type PlaygroundWorkerRequest = Omit<PlaygroundRequest, "files"> & {
  files?: Record<string, PlaygroundFileMetadata>;
  binaryFiles?: Record<string, Uint8Array>;
};

export type ProjectFile =
  | { encoding: "utf8"; content: string }
  | { encoding: "binary"; bytes: Uint8Array };

export type LoadedProject = {
  source: string;
  files: Record<string, ProjectFile>;
  bytes: number;
  fileCount: number;
};

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
  loadProject(files: FileList | File[]): Promise<LoadedProject>;
  run(
    source: string,
    revision: number,
    files?: Record<string, ProjectFile>,
  ): Promise<PlaygroundReply>;
  format(source: string, revision: number): Promise<PlaygroundReply>;
  cancel(): void;
  dispose(): void;
}
