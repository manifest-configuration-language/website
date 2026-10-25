import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const websiteRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const examplesRoot = join(websiteRoot, "src/content/docs/examples");
const catalogPath = join(examplesRoot, "catalog.json");
const output = join(websiteRoot, "src/playground/generatedExamples.json");
const assetsRoot = join(websiteRoot, "public/playground-examples");
const categories = new Map([
  ["adapters", { en: "Integrations", ja: "連携" }],
  ["composition", { en: "Composition", ja: "構成" }],
  ["language", { en: "Language", ja: "言語" }],
  ["modules", { en: "Modules", ja: "モジュール" }],
  ["projects", { en: "Projects", ja: "プロジェクト" }],
  ["references", { en: "References", ja: "参照" }],
  ["resources", { en: "Kubernetes", ja: "Kubernetes" }],
  ["types", { en: "Types", ja: "型" }],
  ["validation", { en: "Validation", ja: "検証" }],
]);
const locales = ["en", "ja"];
const difficulties = new Set([
  "Introductory",
  "Beginner",
  "Intermediate",
  "Advanced",
  "入門",
  "初級",
  "中級",
  "応用",
]);
const decoder = new TextDecoder("utf-8", { fatal: true });
const catalog = JSON.parse(await readFile(catalogPath, "utf8"));

if (!catalog || typeof catalog !== "object" || Array.isArray(catalog))
  throw new Error("Example catalog must be an object keyed by example slug.");

function metadataFor(slug) {
  const metadata = catalog[slug];
  if (
    !metadata ||
    typeof metadata !== "object" ||
    !locales.every(
      (locale) =>
        typeof metadata.title?.[locale] === "string" &&
        metadata.title[locale].trim() !== "" &&
        typeof metadata.description?.[locale] === "string" &&
        metadata.description[locale].trim() !== "" &&
        typeof metadata.difficulty?.[locale] === "string" &&
        difficulties.has(metadata.difficulty[locale]),
    ) ||
    !Array.isArray(metadata.tags) ||
    metadata.tags.length === 0 ||
    !metadata.tags.every((tag) => typeof tag === "string" && tag.trim() !== "")
  )
    throw new Error(`Example catalog entry is incomplete or invalid: ${slug}`);

  return metadata;
}

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
    const path = join(directory, entry.name);
    if ((await readdir(path)).includes("main.mcl")) matches.push(path);
    await findEntrypoints(path, matches);
  }
  return matches;
}

await rm(assetsRoot, { recursive: true, force: true });
await mkdir(assetsRoot, { recursive: true });
const examples = [];
const usedSlugs = new Set();
for (const sampleRoot of (await findEntrypoints(examplesRoot)).sort()) {
  const relativeRoot = relative(examplesRoot, sampleRoot).split(sep).join("/");
  const [categoryKey, ...slugParts] = relativeRoot.split("/");
  const category = categories.get(categoryKey);
  if (!category) throw new Error(`Missing category for example directory: ${relativeRoot}`);
  const slug = `${categoryKey}/${slugParts.join("/")}`;
  const metadata = metadataFor(slug);
  usedSlugs.add(slug);
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
  const preview = files["main.mcl"].split("\n").slice(0, 6).join("\n").trimEnd();
  examples.push({ ...metadata, category, slug, asset, preview });
}

if (examples.length === 0) throw new Error("No Playground examples were found.");
const unusedSlugs = Object.keys(catalog).filter((slug) => !usedSlugs.has(slug));
if (unusedSlugs.length > 0)
  throw new Error(`Example catalog contains unknown slugs: ${unusedSlugs.join(", ")}`);
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(examples, null, 2)}\n`);

const docs = [
  "---",
  'title: "Examples"',
  'description: "MCLのサンプルプロジェクトをPlaygroundで開きます。"',
  "---",
  "",
];
for (const category of new Set(examples.map((example) => example.category.ja))) {
  docs.push(`## ${category}`, "");
  for (const example of examples.filter((item) => item.category.ja === category)) {
    const tags = example.tags.map((tag) => `\`${tag}\``).join("、");
    docs.push(
      `### ${example.title.ja}`,
      "",
      example.description.ja,
      "",
      `難易度は${example.difficulty.ja}です。タグは${tags}です。`,
      "",
      `- [Playgroundで開く](/playground/?example=${encodeURIComponent(example.slug)})`,
      "",
    );
  }
}
await writeFile(join(examplesRoot, "index.mdx"), `${docs.join("\n")}\n`);
console.log(`Prepared ${examples.length} local Playground examples.`);
