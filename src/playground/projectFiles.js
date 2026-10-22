import { isSafeProjectPath, projectLimits } from "./projectValidation.js";

const textExtensions = new Set([
  "mcl",
  "yaml",
  "yml",
  "json",
  "jsonnet",
  "tpl",
  "txt",
  "md",
  "lock",
  "toml",
  "properties",
  "xml",
  "sh",
  "conf",
]);

function validatePath(path) {
  if (!isSafeProjectPath(path)) throw new Error(`Invalid project path: ${path}`);
}

export async function readProject(files) {
  const selected = [...files];
  if (selected.length === 0) throw new Error("Select a project folder.");
  if (selected.length > projectLimits.projectFiles)
    throw new Error(
      `A project can contain at most ${projectLimits.projectFiles.toLocaleString()} files.`,
    );

  const paths = selected.map((file) => file.webkitRelativePath || file.name);
  const roots = new Set(paths.map((path) => path.split("/")[0]));
  const stripRoot = roots.size === 1 && selected.some((file) => file.webkitRelativePath !== "");
  const entries = selected.map((file, index) => ({
    file,
    path: stripRoot ? paths[index].slice(paths[index].indexOf("/") + 1) : paths[index],
  }));
  const seen = new Set();
  for (const { path } of entries) {
    validatePath(path);
    if (seen.has(path)) throw new Error(`Duplicate project path: ${path}`);
    seen.add(path);
  }

  const main = entries.find(({ path }) => path === "main.mcl");
  if (!main) throw new Error("The selected directory must contain main.mcl at its root.");
  if (main.file.size > projectLimits.sourceBytes)
    throw new Error(`main.mcl exceeds the ${projectLimits.sourceBytes / 1024} KiB limit.`);

  let bytes = main.file.size;
  const otherFiles = entries.filter(({ file }) => file !== main.file);
  for (const { file, path } of otherFiles) {
    if (file.size > projectLimits.fileBytes)
      throw new Error(
        `${path} exceeds the ${projectLimits.fileBytes / 1024 / 1024} MiB per-file limit.`,
      );
    bytes += file.size;
    if (bytes > projectLimits.projectBytes)
      throw new Error(
        `The project exceeds the ${projectLimits.projectBytes / 1024 / 1024} MiB total limit.`,
      );
  }

  const project = Object.create(null);
  for (const { file, path } of otherFiles) {
    const extension = path.split(".").pop()?.toLowerCase() ?? "";
    project[path] = textExtensions.has(extension)
      ? { encoding: "utf8", content: await file.text() }
      : { encoding: "binary", bytes: new Uint8Array(await file.arrayBuffer()) };
  }
  const source = await main.file.text();
  if (new TextEncoder().encode(source).byteLength > projectLimits.sourceBytes)
    throw new Error(`main.mcl exceeds the ${projectLimits.sourceBytes / 1024} KiB limit.`);

  return { source, files: project, bytes, fileCount: entries.length };
}
