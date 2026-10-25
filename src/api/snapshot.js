import {
  isValidProjectFileSet,
  isValidProjectPath,
  maxProjectBytes,
  maxProjectFileBytes,
  maxProjectFiles,
  maxSourceBytes,
} from "@manifest-configuration-language/browser";

export const maximumSnapshotBytes = Math.min(maxProjectBytes, 32 * 1024 * 1024);
export const maximumRequestBytes = Math.ceil((maximumSnapshotBytes * 4) / 3) + 1024 * 1024;

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const invalid = () => new Error("Invalid shared project");

function binarySize(content) {
  if (!/^[A-Za-z0-9_-]*$/.test(content) || content.length % 4 === 1) throw invalid();
  const bytes = Buffer.from(content, "base64url");
  if (bytes.toString("base64url") !== content) throw invalid();
  return bytes.byteLength;
}

export function validateSnapshot(value) {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    typeof value.source !== "string" ||
    !isRecord(value.files) ||
    (value.activePath !== undefined && typeof value.activePath !== "string")
  )
    throw invalid();

  const paths = ["main.mcl", ...Object.keys(value.files)];
  if (paths.length > maxProjectFiles || !isValidProjectFileSet(paths)) throw invalid();
  const sourceBytes = Buffer.byteLength(value.source, "utf8");
  if (sourceBytes > maxSourceBytes || sourceBytes > maximumSnapshotBytes) throw invalid();
  let contentBytes = sourceBytes;
  const files = Object.create(null);
  for (const [path, file] of Object.entries(value.files)) {
    if (
      path === "main.mcl" ||
      !isValidProjectPath(path) ||
      !isRecord(file) ||
      typeof file.content !== "string"
    )
      throw invalid();
    const size =
      file.encoding === "utf8"
        ? Buffer.byteLength(file.content, "utf8")
        : file.encoding === "binary"
          ? binarySize(file.content)
          : -1;
    if (size < 0 || size > maxProjectFileBytes) throw invalid();
    contentBytes += size;
    if (contentBytes > maximumSnapshotBytes) throw invalid();
    files[path] = { encoding: file.encoding, content: file.content };
  }
  if (
    value.activePath !== undefined &&
    value.activePath !== "main.mcl" &&
    files[value.activePath]?.encoding !== "utf8"
  )
    throw invalid();

  const snapshot = {
    version: 1,
    source: value.source,
    files,
    ...(value.activePath === undefined ? {} : { activePath: value.activePath }),
  };
  const serialized = Buffer.from(JSON.stringify(snapshot), "utf8");
  if (serialized.byteLength > maximumRequestBytes) throw invalid();
  return { snapshot, serialized, contentBytes };
}
