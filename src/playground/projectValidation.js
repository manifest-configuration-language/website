import {
  isValidProjectPath,
  maxProjectBytes,
  maxProjectFiles,
  maxProjectPathDepth,
  maxProjectPathLength,
} from "@manifest-configuration-language/browser";

const playgroundProjectBytes = 32 * 1024 * 1024;
export { isValidProjectPath, maxProjectPathDepth, maxProjectPathLength };

export const projectLimits = {
  projectFiles: maxProjectFiles,
  projectBytes: Math.min(maxProjectBytes, playgroundProjectBytes),
  projectPathDepth: maxProjectPathDepth,
  projectPathLength: maxProjectPathLength,
};

export function isValidProjectFileSet(paths) {
  if (!Array.isArray(paths)) return false;
  const files = new Set();
  const directories = new Set();
  for (const path of paths) {
    if (!isValidProjectPath(path) || files.has(path) || directories.has(path)) return false;
    let separator = path.indexOf("/");
    while (separator !== -1) {
      const directory = path.slice(0, separator);
      if (files.has(directory)) return false;
      directories.add(directory);
      separator = path.indexOf("/", separator + 1);
    }
    files.add(path);
  }
  return true;
}

export function normalizeImportedProjectPaths(paths, hasRelativePaths) {
  const roots = new Set(paths.map((path) => path.split("/")[0]));
  if (!hasRelativePaths || roots.size !== 1 || paths.includes([...roots][0])) return paths;
  return paths.map((path) => {
    const separator = path.indexOf("/");
    return separator === -1 ? path : path.slice(separator + 1);
  });
}
