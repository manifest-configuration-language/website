import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const websiteRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(join(websiteRoot, "package.json"), "utf8"));
const version = packageJson.dependencies?.["@manifest-configuration-language/language"];
if (typeof version !== "string" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error("The pinned Language package version must be an exact semantic version.");
}
if (packageJson.dependencies?.["@manifest-configuration-language/browser"] !== version) {
  throw new Error("The MCL Browser and Language package versions must match.");
}

const sourceRoot = join(
  websiteRoot,
  "node_modules/@manifest-configuration-language/language/reference",
);
const sourceCli = join(sourceRoot, "cli");
const referenceEntries = await readdir(sourceRoot, { withFileTypes: true });
const unexpectedReferenceEntries = referenceEntries
  .filter(
    (entry) =>
      !(
        (entry.isDirectory() && entry.name === "cli") ||
        (entry.isFile() && entry.name === "stdlib-functions.md")
      ),
  )
  .map((entry) => entry.name);
if (unexpectedReferenceEntries.length > 0 || referenceEntries.length !== 2) {
  throw new Error(
    `Unexpected Language reference entries: ${unexpectedReferenceEntries.join(", ") || "expected cli/ and stdlib-functions.md"}`,
  );
}

const cliEntries = await readdir(sourceCli, { withFileTypes: true });
const invalidCliEntries = cliEntries.filter(
  (entry) => !entry.isFile() || !/^(?:mcl|mcl_[a-z0-9]+(?:_[a-z0-9]+)*)\.md$/.test(entry.name),
);
if (invalidCliEntries.length > 0) {
  throw new Error(
    `Unexpected CLI reference entries: ${invalidCliEntries.map((entry) => entry.name).join(", ")}`,
  );
}
const commandFiles = cliEntries.map((entry) => entry.name).sort();
if (!commandFiles.includes("mcl.md"))
  throw new Error("The Reference package is missing reference/cli/mcl.md.");
const functionsFile = join(sourceRoot, "stdlib-functions.md");
if (!(await stat(functionsFile)).isFile())
  throw new Error("The Language package is missing reference/stdlib-functions.md.");
const files = new Map();
for (const name of commandFiles)
  files.set(`reference/cli/${name}`, await readFile(join(sourceCli, name)));
files.set("reference/stdlib-functions.md", await readFile(functionsFile));

const docsRoot = join(websiteRoot, "src/content/docs/reference");
const generatedCli = join(docsRoot, "cli-commands");
const generatedFunctions = join(docsRoot, "stdlib-functions.md");
const stagingRoot = join(docsRoot, `.reference-staging-${process.pid}`);
await rm(stagingRoot, { recursive: true, force: true });
await mkdir(join(stagingRoot, "cli-commands"), { recursive: true });
const commandLinks = commandFiles.map((basename) => {
  const slug = basename.slice(0, -3);
  const label =
    basename === "mcl.md" ? "mcl" : `mcl ${slug.slice("mcl_".length).replaceAll("_", " ")}`;
  return `- [\`${label}\`](./${slug}/)`;
});
await writeFile(
  join(stagingRoot, "cli-commands", "index.md"),
  `---\ntitle: "CLIコマンド"\n---\n\n# CLIコマンド\n\n${commandLinks.join("\n")}\n`,
  { flag: "wx" },
);
for (const [path, content] of files) {
  if (path.startsWith("reference/cli/")) {
    const basename = path.slice("reference/cli/".length);
    const title =
      basename === "mcl.md"
        ? "mcl"
        : `mcl ${basename.slice("mcl_".length, -3).replaceAll("_", " ")}`;
    await writeFile(
      join(stagingRoot, "cli-commands", basename),
      `---\ntitle: "${title}"\n---\n\n${content.toString("utf8")}`,
      { flag: "wx" },
    );
  } else if (path === "reference/stdlib-functions.md") {
    const contentText = content.toString("utf8").replace(/^MCL version: `[^`]+`\n\n/, "");
    await writeFile(
      join(stagingRoot, "stdlib-functions.md"),
      `---\ntitle: "標準関数一覧"\n---\n\n${contentText}`,
      { flag: "wx" },
    );
  }
}

await rm(generatedCli, { recursive: true, force: true });
await rm(generatedFunctions, { force: true });
await rename(join(stagingRoot, "cli-commands"), generatedCli);
await rename(join(stagingRoot, "stdlib-functions.md"), generatedFunctions);
await rm(stagingRoot, { recursive: true, force: true });
console.log(`Generated CLI and standard-library references for MCL ${version}.`);
