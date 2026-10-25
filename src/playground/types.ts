import type {
  CompletionItem as BrowserCompletionItem,
  CompletionPosition as BrowserCompletionPosition,
  DefinitionLocation as BrowserDefinitionLocation,
  HoverInfo as BrowserHoverInfo,
  ReferenceLocation as BrowserReferenceLocation,
  RenameEdit as BrowserRenameEdit,
  SourceMap as BrowserSourceMap,
} from "@manifest-configuration-language/browser";

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

export type PlaygroundCompletionItem = BrowserCompletionItem;
export type PlaygroundCompletionPosition = BrowserCompletionPosition;

export type PlaygroundDefinitionLocation = BrowserDefinitionLocation;
export type PlaygroundHover = BrowserHoverInfo & {
  standardLibrary?: { module: string; name: string };
};

export type PlaygroundSourceMap = BrowserSourceMap;
export type PlaygroundRenameEdit = BrowserRenameEdit;
export type PlaygroundReference = BrowserReferenceLocation;

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
    sourceMap?: PlaygroundSourceMap;
    diagnostics?: PlaygroundDiagnostic[];
  };
  error?: PlaygroundDiagnostic;
};

export type PlaygroundPriority = "interactive" | "background";

export interface PlaygroundClient {
  loadProject(files: FileList | File[]): Promise<LoadedProject>;
  warmUp(priority?: PlaygroundPriority): Promise<void>;
  lint(
    source: string,
    revision: number,
    files?: Record<string, ProjectFile>,
    priority?: PlaygroundPriority,
  ): Promise<PlaygroundReply>;
  complete(
    source: string,
    entrypoint: string,
    position: PlaygroundCompletionPosition,
    files?: Record<string, ProjectFile>,
    priority?: PlaygroundPriority,
  ): Promise<PlaygroundCompletionItem[]>;
  definition(
    source: string,
    entrypoint: string,
    position: PlaygroundCompletionPosition,
    files?: Record<string, ProjectFile>,
    priority?: PlaygroundPriority,
  ): Promise<PlaygroundDefinitionLocation | null>;
  hover(
    source: string,
    entrypoint: string,
    position: PlaygroundCompletionPosition,
    files?: Record<string, ProjectFile>,
    priority?: PlaygroundPriority,
  ): Promise<PlaygroundHover | null>;
  rename(
    source: string,
    entrypoint: string,
    position: PlaygroundCompletionPosition,
    newName: string,
    files?: Record<string, ProjectFile>,
    priority?: PlaygroundPriority,
  ): Promise<PlaygroundRenameEdit[]>;
  renameFileImports(
    source: string,
    files: Record<string, ProjectFile>,
    oldPath: string,
    newPath: string,
  ): Promise<PlaygroundRenameEdit[]>;
  references(
    source: string,
    entrypoint: string,
    position: PlaygroundCompletionPosition,
    files?: Record<string, ProjectFile>,
    priority?: PlaygroundPriority,
  ): Promise<PlaygroundReference[]>;
  run(
    source: string,
    revision: number,
    files?: Record<string, ProjectFile>,
    priority?: PlaygroundPriority,
  ): Promise<PlaygroundReply>;
  format(source: string, revision: number, priority?: PlaygroundPriority): Promise<PlaygroundReply>;
  cancel(): void;
  dispose(): void;
}
