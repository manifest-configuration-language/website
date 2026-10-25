import {
  isValidProjectFileSet,
  isValidProjectPath,
  normalizeImportedProjectPaths,
  projectSnapshotError,
  projectLimits,
} from "./projectValidation.js";

export { isValidProjectPath };

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
  const normalizedPaths = normalizeImportedProjectPaths(
    paths,
    selected.some((file) => file.webkitRelativePath !== ""),
  );
  const entries = selected.map((file, index) => ({ file, path: normalizedPaths[index] }));
  for (const { path } of entries) {
    if (!isValidProjectPath(path)) throw new Error(`Invalid project path: ${path}`);
  }
  if (new Set(normalizedPaths).size !== normalizedPaths.length)
    throw new Error("The project contains duplicate file paths.");
  if (!isValidProjectFileSet(normalizedPaths))
    throw new Error("Project file paths cannot overlap files and directories.");

  const main = entries.find(({ path }) => path === "main.mcl");
  if (!main) throw new Error("The selected directory must contain main.mcl at its root.");

  if (main.file.size > projectLimits.sourceBytes)
    throw new Error(`Source exceeds the ${projectLimits.sourceBytes / 1024 / 1024} MiB limit.`);
  for (const { file } of entries) {
    if (file.size > projectLimits.projectFileBytes)
      throw new Error(
        `Project files cannot exceed ${projectLimits.projectFileBytes / 1024 / 1024} MiB.`,
      );
  }
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

  const snapshotError = projectSnapshotError({ source, files: project });
  if (snapshotError) throw new Error(snapshotError);

  return { source, files: project, bytes, fileCount: entries.length };
}
