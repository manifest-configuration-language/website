import {
  isValidProjectFileSet,
  isValidProjectPath,
  maxProjectBytes,
  maxProjectFileBytes,
  maxProjectFiles,
  maxProjectPathDepth,
  maxProjectPathLength,
  maxSourceBytes,
} from "@manifest-configuration-language/browser";

const playgroundProjectBytes = 32 * 1024 * 1024;
export { isValidProjectPath, maxProjectPathDepth, maxProjectPathLength };
export { isValidProjectFileSet };

export const projectLimits = {
  projectFiles: maxProjectFiles,
  projectBytes: Math.min(maxProjectBytes, playgroundProjectBytes),
  projectFileBytes: maxProjectFileBytes,
  sourceBytes: maxSourceBytes,
  projectPathDepth: maxProjectPathDepth,
  projectPathLength: maxProjectPathLength,
};

const encoder = new TextEncoder();

export function projectSnapshotError(snapshot, knownFileSizes) {
  if (!snapshot || typeof snapshot !== "object") return "Invalid project";
  const { source, files, activePath } = snapshot;
  if (
    typeof source !== "string" ||
    !files ||
    typeof files !== "object" ||
    Array.isArray(files) ||
    (activePath !== undefined && typeof activePath !== "string")
  )
    return "Invalid project";

  const entries = Object.entries(files);
  const paths = ["main.mcl", ...entries.map(([path]) => path)];
  if (
    knownFileSizes &&
    (Object.keys(knownFileSizes).length !== paths.length ||
      !Object.hasOwn(knownFileSizes, "main.mcl") ||
      entries.some(([path]) => !Object.hasOwn(knownFileSizes, path)))
  )
    return "Invalid project size metadata";
  if (paths.length > projectLimits.projectFiles) return "Project has too many files";
  if (entries.some(([path]) => !isValidProjectPath(path) || path === "main.mcl"))
    return "Project contains an invalid file path";
  if (!isValidProjectFileSet(paths)) return "Project file paths overlap files and directories";
  if (
    activePath !== undefined &&
    (!isValidProjectPath(activePath) ||
      (activePath !== "main.mcl" &&
        (!Object.hasOwn(files, activePath) || files[activePath]?.encoding !== "utf8")))
  )
    return "Invalid active project path";

  const sourceBytes = encoder.encode(source).byteLength;
  if (knownFileSizes && knownFileSizes["main.mcl"] !== sourceBytes)
    return "Invalid project size metadata";
  if (sourceBytes > projectLimits.sourceBytes) return "Source exceeds the size limit";
  let totalBytes = sourceBytes;
  for (const [path, file] of entries) {
    if (!file || typeof file !== "object") return "Invalid project file";
    let fileBytes;
    if (file.encoding === "utf8" && typeof file.content === "string") {
      fileBytes = knownFileSizes?.[path] ?? encoder.encode(file.content).byteLength;
    } else if (file.encoding === "binary" && file.bytes instanceof Uint8Array) {
      fileBytes = knownFileSizes?.[path] ?? file.bytes.byteLength;
    } else return "Invalid project file";
    if (!Number.isSafeInteger(fileBytes) || fileBytes < 0) return "Invalid project size metadata";
    if (fileBytes > projectLimits.projectFileBytes) return "Project file exceeds the size limit";
    totalBytes += fileBytes;
    if (totalBytes > projectLimits.projectBytes) return "Project exceeds the size limit";
  }
  if (knownFileSizes && snapshot.totalBytes !== totalBytes) return "Invalid project size metadata";
  return undefined;
}

export function projectSnapshotErrorMessage(error) {
  if (error === "Source exceeds the size limit")
    return `MCLソースの上限は${projectLimits.sourceBytes / 1024} KiBです`;
  if (error === "Project file exceeds the size limit")
    return `各ファイルの上限は${projectLimits.projectFileBytes / (1024 * 1024)} MiBです`;
  if (error === "Project exceeds the size limit")
    return `プロジェクトの上限は${projectLimits.projectBytes / (1024 * 1024)} MiBです`;
  if (error === "Project has too many files")
    return `プロジェクトのファイル数は${projectLimits.projectFiles}件までです`;
  if (error === "Invalid active project path") return "選択中のファイルが使用できません";
  if (error === "Invalid project size metadata")
    return "プロジェクトのサイズ情報が正しくありません";
  if (error === "Project contains an invalid file path") return "使用できないファイルパスです";
  if (error === "Project file paths overlap files and directories")
    return "ファイルとディレクトリのパスが重複しています";
  return "プロジェクトを更新できません";
}

export function isValidProjectSnapshot(snapshot) {
  return projectSnapshotError(snapshot) === undefined;
}

export function normalizeImportedProjectPaths(paths, hasRelativePaths) {
  const roots = new Set(paths.map((path) => path.split("/")[0]));
  if (!hasRelativePaths || roots.size !== 1 || paths.includes([...roots][0])) return paths;
  return paths.map((path) => {
    const separator = path.indexOf("/");
    return separator === -1 ? path : path.slice(separator + 1);
  });
}
