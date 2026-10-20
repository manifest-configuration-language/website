import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

async function htmlFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await htmlFiles(entryPath)));
    else if (entry.name.endsWith(".html")) files.push(entryPath);
  }
  return files;
}

const [siteDirectory, outputPath] = process.argv.slice(2);
if (!siteDirectory || !outputPath)
  throw new Error("Usage: node write-csp.mjs <site-directory> <output-file>");
const hashes = new Set();
for (const filePath of await htmlFiles(siteDirectory)) {
  const html = await readFile(filePath, "utf8");
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/\bsrc\s*=/.test(match[1]) || match[2].trim() === "") continue;
    hashes.add(`'sha256-${createHash("sha256").update(match[2]).digest("base64")}'`);
  }
}
const template = await readFile("security-headers.conf", "utf8");
if (!template.includes("{{SCRIPT_HASHES}}"))
  throw new Error("CSP template is missing the inline script hash placeholder.");
await writeFile(outputPath, template.replace("{{SCRIPT_HASHES}}", [...hashes].join(" ")));
