export type PlaygroundDiagnostic = {
  code: string;
  message: string;
  severity: string;
  line: number;
  column: number;
  path?: string;
  endLine?: number;
  endColumn?: number;
  related?: Array<{
    path?: string;
    line: number;
    column: number;
    endLine?: number;
    endColumn?: number;
    message: string;
  }>;
};

export type PlaygroundCompletionItem = {
  label: string;
  kind: number;
  insertText?: string;
};

export type PlaygroundCompletionPosition = {
  line: number;
  character: number;
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
    artifacts?: number;
    renderedBytes?: number;
    diagnostics?: PlaygroundDiagnostic[];
  };
  error?: PlaygroundDiagnostic;
};

export interface PlaygroundClient {
  loadProject(files: FileList | File[]): Promise<LoadedProject>;
  warmUp(): Promise<void>;
  lint(
    source: string,
    revision: number,
    files?: Record<string, ProjectFile>,
  ): Promise<PlaygroundReply>;
  complete(
    source: string,
    entrypoint: string,
    position: PlaygroundCompletionPosition,
    files?: Record<string, ProjectFile>,
  ): Promise<PlaygroundCompletionItem[]>;
  run(
    source: string,
    revision: number,
    files?: Record<string, ProjectFile>,
  ): Promise<PlaygroundReply>;
  format(source: string, revision: number): Promise<PlaygroundReply>;
  cancel(): void;
  dispose(): void;
}
