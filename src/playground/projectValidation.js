export const projectLimits = {
  sourceBytes: 64 * 1024,
  projectFiles: 4096,
  fileBytes: 16 * 1024 * 1024,
  projectBytes: 32 * 1024 * 1024,
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

function projectFileBytes(file, binary) {
  if (!file) return undefined;
  if (file.encoding === "utf8") {
    if (typeof file.content !== "string") return undefined;
    return new TextEncoder().encode(file.content).byteLength;
  }
  if (file.encoding === "binary") {
    if (!(binary instanceof Uint8Array)) return undefined;
    return binary.byteLength;
  }
  return undefined;
}

export function validateProjectInput(source, files, binaryFiles = {}) {
  if (
    typeof source !== "string" ||
    new TextEncoder().encode(source).byteLength > projectLimits.sourceBytes
  )
    return false;

  const entries = Object.entries(files ?? {});
  if (entries.length + 1 > projectLimits.projectFiles) return false;
  const binaries = Object.entries(binaryFiles ?? {});
  if (binaries.length > projectLimits.projectFiles - 1) return false;
  const binaryPaths = new Set(binaries.map(([filePath]) => filePath));
  if (binaryPaths.size !== binaries.length) return false;

  let totalBytes = new TextEncoder().encode(source).byteLength;
  for (const [filePath, file] of entries) {
    const safePath = isSafeProjectPath(filePath);
    const binary = binaryPaths.has(filePath)
      ? Object.hasOwn(binaryFiles, filePath) && binaryFiles[filePath]
      : undefined;
    const fileBytes = projectFileBytes(file, binary);
    if (file?.encoding === "binary") binaryPaths.delete(filePath);
    else if (binary !== undefined) return false;
    if (!safePath || fileBytes === undefined || fileBytes > projectLimits.fileBytes) return false;

    totalBytes += fileBytes;
    if (totalBytes > projectLimits.projectBytes) return false;
  }

  return binaryPaths.size === 0;
}
