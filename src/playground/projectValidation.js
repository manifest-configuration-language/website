import {
  maxProjectBytes,
  maxProjectFiles,
} from "@manifest-configuration-language/browser";

const playgroundProjectBytes = 32 * 1024 * 1024;

export const projectLimits = {
  projectFiles: maxProjectFiles,
  projectBytes: Math.min(maxProjectBytes, playgroundProjectBytes),
};
