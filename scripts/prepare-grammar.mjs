import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const config = JSON.parse(await readFile(path.join(root, "vscode-grammar.json"), "utf8"));
const output = path.join(root, "src/playground/mcl.tmLanguage.json");
const stamp = path.join(root, ".build/vscode-grammar-ref");
try {
  const [currentRef] = await Promise.all([readFile(stamp, "utf8"), access(output)]);
  if (currentRef === config.ref) process.exit(0);
} catch {}
const response = await fetch(
  `https://raw.githubusercontent.com/${config.repository}/${config.ref}/${config.path}`,
  { headers: { "User-Agent": "mcl-website-build" } },
);
if (!response.ok) throw new Error(`Unable to download MCL grammar: HTTP ${response.status}`);
const grammar = await response.text();
JSON.parse(grammar);
await mkdir(path.dirname(output), { recursive: true });
await mkdir(path.dirname(stamp), { recursive: true });
await writeFile(output, grammar);
await writeFile(stamp, config.ref);
