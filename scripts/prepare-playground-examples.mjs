import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const websiteRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const examplesRoot = join(websiteRoot, "src/content/docs/examples");
const output = join(websiteRoot, "src/playground/generatedExamples.json");
const assetsRoot = join(websiteRoot, "public/playground-examples");
const categories = new Map([
  ["adapters", "Integrations"],
  ["composition", "Composition"],
  ["language", "Language"],
  ["modules", "Modules"],
  ["projects", "Projects"],
  ["references", "References"],
  ["resources", "Kubernetes"],
  ["types", "Types"],
  ["validation", "Validation"],
]);
const titles = new Map([["validation/crd-validation", "CRD Validation"]]);
const decoder = new TextDecoder("utf-8", { fatal: true });

async function collectFiles(directory, sampleRoot, files) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === "expected.yaml") continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await collectFiles(path, sampleRoot, files);
      continue;
    }
    if (!entry.isFile())
      throw new Error(`Unsupported example input: ${relative(examplesRoot, path)}`);
    const contents = await readFile(path);
    const relativePath = relative(sampleRoot, path).split(sep).join("/");
    try {
      files[relativePath] = decoder.decode(contents);
    } catch {
      throw new Error(`Example input must be UTF-8 text: ${relative(examplesRoot, path)}`);
    }
  }
}

async function findEntrypoints(directory, matches = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (directory === examplesRoot && !categories.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if ((await readdir(path)).includes("main.mcl")) matches.push(path);
    await findEntrypoints(path, matches);
  }
  return matches;
}

await rm(assetsRoot, { recursive: true, force: true });
await mkdir(assetsRoot, { recursive: true });
const examples = [];
for (const sampleRoot of (await findEntrypoints(examplesRoot)).sort()) {
  const relativeRoot = relative(examplesRoot, sampleRoot).split(sep).join("/");
  const [categoryKey, ...slugParts] = relativeRoot.split("/");
  const category = categories.get(categoryKey);
  if (!category) throw new Error(`Missing category for example directory: ${relativeRoot}`);
  const slug = `${categoryKey}/${slugParts.join("/")}`;
  const title =
    titles.get(slug) ??
    slugParts
      .at(-1)
      .split("-")
      .map((part) => part[0].toUpperCase() + part.slice(1))
      .join(" ");
  const files = {};
  await collectFiles(sampleRoot, sampleRoot, files);
  if (!Object.hasOwn(files, "main.mcl")) {
    throw new Error(`Example is missing main.mcl: ${relativeRoot}`);
  }
  const assetContents = `${JSON.stringify({ files }, null, 2)}\n`;
  const digest = createHash("sha256").update(assetContents).digest("hex").slice(0, 16);
  const asset = `/playground-examples/${slug}.${digest}.json`;
  await mkdir(dirname(join(assetsRoot, `${slug}.${digest}.json`)), { recursive: true });
  await writeFile(join(assetsRoot, `${slug}.${digest}.json`), assetContents);
  examples.push({ category, title, slug, asset });
}

if (examples.length === 0) throw new Error("No Playground examples were found.");
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(examples, null, 2)}\n`);

const docs = [
  "---",
  'title: "Examples"',
  'description: "MCLのサンプルプロジェクトをPlaygroundで開きます。"',
  "---",
  "",
];
for (const category of new Set(examples.map((example) => example.category))) {
  docs.push(`## ${category}`, "");
  for (const example of examples.filter((item) => item.category === category)) {
    docs.push(`- [${example.title}](/playground/?example=${encodeURIComponent(example.slug)})`);
  }
  docs.push("");
}
await writeFile(join(examplesRoot, "index.mdx"), `${docs.join("\n")}\n`);
console.log(`Prepared ${examples.length} local Playground examples.`);
