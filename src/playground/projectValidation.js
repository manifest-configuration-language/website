const limits = {
  sourceBytes: 64 * 1024,
  projectFiles: 4096,
  fileBytes: 16 * 1024 * 1024,
  projectBytes: 32 * 1024 * 1024,
};

const base64Pattern = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const base64Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function projectFileBytes(file) {
  if (!file || typeof file.content !== "string") return undefined;
  if (file.encoding === "utf8") return new TextEncoder().encode(file.content).byteLength;
  if (file.encoding !== "base64" || !base64Pattern.test(file.content)) return undefined;

  const padding = file.content.endsWith("==") ? 2 : file.content.endsWith("=") ? 1 : 0;
  const byteLength = (file.content.length / 4) * 3 - padding;
  const finalCharacter = base64Alphabet.indexOf(file.content.at(-(padding + 1)) ?? "");
  if (
    (padding === 2 && (finalCharacter & 15) !== 0) ||
    (padding === 1 && (finalCharacter & 3) !== 0)
  )
    return undefined;
  if (byteLength > limits.fileBytes) return byteLength;
  return byteLength;
}

export function validateProjectInput(source, files) {
  if (
    typeof source !== "string" ||
    new TextEncoder().encode(source).byteLength > limits.sourceBytes
  )
    return false;

  const entries = Object.entries(files ?? {});
  if (entries.length + 1 > limits.projectFiles) return false;

  let totalBytes = new TextEncoder().encode(source).byteLength;
  for (const [filePath, file] of entries) {
    const safePath =
      typeof filePath === "string" &&
      filePath.length > 0 &&
      !filePath.startsWith("/") &&
      !filePath.includes("\\") &&
      filePath.split("/").every((part) => part && part !== "." && part !== "..");
    const fileBytes = projectFileBytes(file);
    if (!safePath || fileBytes === undefined || fileBytes > limits.fileBytes) return false;

    totalBytes += fileBytes;
    if (totalBytes > limits.projectBytes) return false;
  }

  return true;
}
