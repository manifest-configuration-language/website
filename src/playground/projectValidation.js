import {
  isValidProjectFileSet,
  isValidProjectPath,
  maxProjectBytes,
  maxProjectFiles,
  maxProjectPathDepth,
  maxProjectPathLength,
} from "@manifest-configuration-language/browser";

const playgroundProjectBytes = 32 * 1024 * 1024;
export { isValidProjectPath, maxProjectPathDepth, maxProjectPathLength };
export { isValidProjectFileSet };

export const projectLimits = {
  projectFiles: maxProjectFiles,
  projectBytes: Math.min(maxProjectBytes, playgroundProjectBytes),
  projectPathDepth: maxProjectPathDepth,
  projectPathLength: maxProjectPathLength,
};

export function normalizeImportedProjectPaths(paths, hasRelativePaths) {
  const roots = new Set(paths.map((path) => path.split("/")[0]));
  if (!hasRelativePaths || roots.size !== 1 || paths.includes([...roots][0])) return paths;
  return paths.map((path) => {
    const separator = path.indexOf("/");
    return separator === -1 ? path : path.slice(separator + 1);
  });
}
