import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const websiteDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceDirectory = path.join(websiteDirectory, "docs");

async function copyMarkdown(sourcePath, destinationPath, framework) {
  let source = await readFile(sourcePath, "utf8");
  const includes = [...source.matchAll(/<!--@include:\s*(.*?)\s*-->/g)];
  for (const include of includes) {
    const includePath = path.resolve(path.dirname(sourcePath), include[1]);
    const includedContent = await readFile(includePath, "utf8");
    source = source.replace(include[0], includedContent);
  }

  if (sourcePath.endsWith("playground.mdx")) {
    const relativeImport =
      framework === "rspress"
        ? "../../../src/playground/Playground"
        : "../../../../src/playground/Playground";
    source = source.replaceAll("@playground-component", relativeImport);
    if (framework === "astro")
      source = source.replace("<Playground />", "<Playground client:load />");
  }

  if (framework === "astro") {
    const title =
      source.match(/^#\s+(.+)$/m)?.[1]?.trim() ??
      path.basename(sourcePath, path.extname(sourcePath));
    if (source.startsWith("---\n")) {
      const frontmatterEnd = source.indexOf("\n---\n", 4);
      if (frontmatterEnd >= 0) {
        const frontmatter = source.slice(4, frontmatterEnd);
        if (!/^title\s*:/m.test(frontmatter))
          source = `${source.slice(0, frontmatterEnd)}\ntitle: ${JSON.stringify(title)}${source.slice(frontmatterEnd)}`;
      }
    } else {
      source = `---\ntitle: ${JSON.stringify(title)}\n---\n\n${source}`;
    }
  }

  if (framework === "rspress") {
    const route = path
      .relative(path.join(websiteDirectory, ".build/rspress/docs"), destinationPath)
      .replaceAll(path.sep, "/");
    const canonicalPath = route.replace(/\.mdx?$/, "").replace(/(^|\/)index$/, "");
    const canonical = new URL(
      canonicalPath ? `/${canonicalPath}` : "/",
      "https://mcl.walnuts.dev/",
    ).toString();
    const head = `head:\n  - - link\n      - rel: canonical\n        href: ${canonical}\n  - - meta\n      - property: og:url\n        content: ${canonical}\n  - - meta\n      - property: og:site_name\n        content: MCL\n`;
    if (source.startsWith("---\n")) {
      const frontmatterEnd = source.indexOf("\n---\n", 4);
      if (frontmatterEnd >= 0) {
        source = `${source.slice(0, frontmatterEnd)}\n${head}${source.slice(frontmatterEnd)}`;
      }
    } else {
      source = `---\n${head}---\n\n${source}`;
    }
  }

  await mkdir(path.dirname(destinationPath), { recursive: true });
  await writeFile(destinationPath, source);
}

async function syncDirectory(sourcePath, destinationPath, framework) {
  const entries = await readdir(sourcePath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === ".vitepress") continue;
    const sourceEntry = path.join(sourcePath, entry.name);
    const destinationEntry = path.join(destinationPath, entry.name);
    if (entry.isDirectory()) {
      await syncDirectory(sourceEntry, destinationEntry, framework);
    } else if (entry.name.endsWith(".md") || entry.name.endsWith(".mdx")) {
      await copyMarkdown(sourceEntry, destinationEntry, framework);
    } else {
      await mkdir(path.dirname(destinationEntry), { recursive: true });
      await copyFile(sourceEntry, destinationEntry);
    }
  }
}

const framework = process.argv[2] ?? "rspress";
const destinationDirectory =
  framework === "astro"
    ? path.join(websiteDirectory, "astro-prototype/src/content/docs")
    : path.join(websiteDirectory, ".build/rspress/docs");
await rm(destinationDirectory, { recursive: true, force: true });
await syncDirectory(sourceDirectory, destinationDirectory, framework);

const publicSource = path.join(websiteDirectory, "public");
try {
  await stat(publicSource);
  await syncDirectory(publicSource, path.join(destinationDirectory, "public"), framework);
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

const generatedLanguage = path.join(destinationDirectory, "reference/language.md");
if ((await stat(generatedLanguage)).size === 0) {
  throw new Error("The language reference source is empty.");
}
