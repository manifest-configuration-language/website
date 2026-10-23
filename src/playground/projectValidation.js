import {
  maxProjectBytes,
  maxProjectFileBytes,
  maxProjectFiles,
  maxSourceBytes,
} from "@manifest-configuration-language/browser";

const playgroundProjectBytes = 32 * 1024 * 1024;

export const projectLimits = {
  sourceBytes: maxSourceBytes,
  projectFiles: maxProjectFiles,
  fileBytes: maxProjectFileBytes,
  projectBytes: Math.min(maxProjectBytes, playgroundProjectBytes),
};

export function isSafeProjectPath(filePath) {
  return (
    typeof filePath === "string" &&
    filePath.length > 0 &&
    !/^[a-z]:/i.test(filePath) &&
    !filePath.startsWith("/") &&
    !filePath.includes("\\") &&
    filePath.split("/").every((part) => part && part !== "." && part !== "..")
  );
}
