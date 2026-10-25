export type ProjectDropErrorCode = "empty" | "tooManyFiles" | "zipMustBeAlone";

export class ProjectDropError extends Error {
  constructor(readonly code: ProjectDropErrorCode) {
    super(code);
    this.name = "ProjectDropError";
  }
}

type FileHandle = { kind: "file"; name: string; getFile: () => Promise<File> };
type DirectoryHandle = {
  kind: "directory";
  name: string;
  values: () => AsyncIterable<DropHandle>;
};
type DropHandle = FileHandle | DirectoryHandle;
type FileSystemEntry = {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
  file?: (success: (file: File) => void, error: (cause: DOMException) => void) => void;
  createReader?: () => {
    readEntries: (
      success: (entries: FileSystemEntry[]) => void,
      error: (cause: DOMException) => void,
    ) => void;
  };
};
type DataTransferItemWithFileSystem = DataTransferItem & {
  getAsFileSystemHandle?: () => Promise<DropHandle | null>;
  webkitGetAsEntry?: () => FileSystemEntry | null;
};
type DropSource = {
  file?: File | null;
  handle?: Promise<DropHandle | null>;
  entry?: FileSystemEntry | null;
};

function fileWithRelativePath(file: File, path: string): File {
  const imported = new File([file], file.name, {
    type: file.type,
    lastModified: file.lastModified,
  });
  Object.defineProperty(imported, "webkitRelativePath", { value: path });
  return imported;
}

function readEntryFile(entry: FileSystemEntry): Promise<File> {
  return new Promise((resolve, reject) => {
    if (!entry.file) {
      reject(new Error("Unsupported dropped file."));
      return;
    }
    entry.file(resolve, reject);
  });
}

function readDirectoryEntries(entry: FileSystemEntry): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    const reader = entry.createReader?.();
    if (!reader) {
      reject(new Error("Unsupported dropped folder."));
      return;
    }
    reader.readEntries(resolve, reject);
  });
}

export async function readProjectDrop(
  transfer: DataTransfer,
  maximumFiles: number,
): Promise<{ files: File[]; archive: boolean }> {
  const items = [...transfer.items].filter((item) => item.kind === "file");
  const sources: DropSource[] = items.map((item) => {
    const source = item as DataTransferItemWithFileSystem;
    let handle: Promise<DropHandle | null> | undefined;
    try {
      handle = source.getAsFileSystemHandle?.().catch(() => null);
    } catch {
      handle = undefined;
    }
    return {
      file: source.getAsFile(),
      ...(handle ? { handle } : {}),
      entry: source.webkitGetAsEntry?.() ?? undefined,
    };
  });
  if (sources.length === 0) sources.push(...[...transfer.files].map((file) => ({ file })));

  if (sources.length === 1 && sources[0]?.file?.name.toLowerCase().endsWith(".zip"))
    return { files: [sources[0].file], archive: true };
  if (sources.some((source) => source.file?.name.toLowerCase().endsWith(".zip")))
    throw new ProjectDropError("zipMustBeAlone");
  if (sources.length === 0) throw new ProjectDropError("empty");

  const files: File[] = [];
  const addFile = (file: File, relativePath: string) => {
    if (files.length >= maximumFiles) throw new ProjectDropError("tooManyFiles");
    files.push(fileWithRelativePath(file, relativePath));
  };

  async function addHandle(handle: DropHandle, parentPath: string, depth: number): Promise<void> {
    if (depth > 64) throw new Error("Dropped folder nesting is too deep.");
    const relativePath = parentPath ? `${parentPath}/${handle.name}` : handle.name;
    if (handle.kind === "file") {
      addFile(await handle.getFile(), relativePath);
      return;
    }
    for await (const child of handle.values()) await addHandle(child, relativePath, depth + 1);
  }

  async function addEntry(
    entry: FileSystemEntry,
    parentPath: string,
    depth: number,
  ): Promise<void> {
    if (depth > 64) throw new Error("Dropped folder nesting is too deep.");
    const relativePath = parentPath ? `${parentPath}/${entry.name}` : entry.name;
    if (entry.isFile) {
      addFile(await readEntryFile(entry), relativePath);
      return;
    }
    if (!entry.isDirectory) throw new Error("Unsupported dropped item.");
    while (true) {
      const children = await readDirectoryEntries(entry);
      if (children.length === 0) return;
      for (const child of children) await addEntry(child, relativePath, depth + 1);
    }
  }

  for (const source of sources) {
    let handle: DropHandle | null | undefined;
    try {
      handle = await source.handle;
    } catch {
      handle = undefined;
    }
    if (handle) {
      await addHandle(handle, "", 0);
      continue;
    }
    if (source.entry) {
      await addEntry(source.entry, "", 0);
      continue;
    }
    if (source.file) addFile(source.file, source.file.name);
  }

  if (files.length === 0) throw new ProjectDropError("empty");
  return { files, archive: false };
}
