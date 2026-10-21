import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "parse5";

async function htmlFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await htmlFiles(entryPath)));
    else if (entry.name.endsWith(".html")) files.push(entryPath);
  }
  return files;
}

function inlineScripts(node, scripts = []) {
  if (node.tagName === "script") {
    const attributes = new Map((node.attrs ?? []).map(({ name, value }) => [name, value]));
    const type = (attributes.get("type") ?? "").trim().toLowerCase();
    const isJavaScript =
      type === "" ||
      type === "module" ||
      type === "importmap" ||
      /^(?:application|text)\/(?:x-)?(?:java|ecma)script(?:\d+(?:\.\d+)?)?(?:\s*;|$)/.test(type);
    if (!attributes.has("src") && isJavaScript) {
      const source = (node.childNodes ?? [])
        .filter((child) => child.nodeName === "#text")
        .map((child) => child.value)
        .join("");
      if (source.trim()) scripts.push(source);
    }
  }
  for (const child of node.childNodes ?? []) inlineScripts(child, scripts);
  return scripts;
}

const [siteDirectory, outputPath] = process.argv.slice(2);
if (!siteDirectory || !outputPath)
  throw new Error("Usage: node write-csp.mjs <site-directory> <output-file>");
const hashes = new Set();
for (const filePath of await htmlFiles(siteDirectory)) {
  const document = parse(await readFile(filePath, "utf8"));
  for (const source of inlineScripts(document)) {
    hashes.add(`'sha256-${createHash("sha256").update(source).digest("base64")}'`);
  }
}
const template = await readFile("security-headers.conf", "utf8");
const placeholder = "{{SCRIPT_HASHES}}";
if (template.split(placeholder).length !== 2)
  throw new Error("CSP template must contain exactly one inline script hash placeholder.");
await writeFile(outputPath, template.replace("{{SCRIPT_HASHES}}", [...hashes].join(" ")));
