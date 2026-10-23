import { projectLimits } from "./projectValidation.js";

const maxProjectPathLength = 512;
const maxProjectPathDepth = 64;

export function isValidProjectPath(path) {
  return path.length <= maxProjectPathLength &&
    path.split("/").length <= maxProjectPathDepth &&
    path.length > 0 && !path.startsWith("/") && !path.includes("\\") &&
    !path.includes("\0") &&
    path.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

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
    if (!isValidProjectPath(path)) throw new Error(`Invalid project path: ${path}`);
    if (seen.has(path)) throw new Error(`Duplicate project path: ${path}`);
    seen.add(path);
  }

  const main = entries.find(({ path }) => path === "main.mcl");
  if (!main) throw new Error("The selected directory must contain main.mcl at its root.");

  const bytes = entries.reduce((total, { file }) => total + file.size, 0);
  if (bytes > projectLimits.projectBytes)
    throw new Error(
      `The project exceeds the ${projectLimits.projectBytes / 1024 / 1024} MiB total limit.`,
    );
  const otherFiles = entries.filter(({ file }) => file !== main.file);

  const project = Object.create(null);
  for (const { file, path } of otherFiles) {
    const extension = path.split(".").pop()?.toLowerCase() ?? "";
    project[path] = textExtensions.has(extension)
      ? { encoding: "utf8", content: await file.text() }
      : { encoding: "binary", bytes: new Uint8Array(await file.arrayBuffer()) };
  }
  const source = await main.file.text();

  return { source, files: project, bytes, fileCount: entries.length };
}
