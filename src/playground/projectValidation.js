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
