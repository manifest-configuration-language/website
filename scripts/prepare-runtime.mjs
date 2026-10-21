import { createWriteStream } from "node:fs";
import { access, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const config = JSON.parse(await readFile(path.join(root, "mcl-runtime.json"), "utf8"));
const buildDirectory = path.join(root, ".build/mcl-core");
const archivePath = path.join(root, ".build/mcl-core.tar.gz");
const runtimeDirectory = path.join(root, ".build/runtime");
const stampPath = path.join(root, ".build/mcl-runtime-ref");

try {
  const [currentRef] = await Promise.all([
    readFile(stampPath, "utf8"),
    access(path.join(root, "public/mcl.wasm.gz")),
    access(path.join(root, "public/wasm_exec.js")),
  ]);
  if (currentRef === config.ref) process.exit(0);
} catch {}

await mkdir(path.dirname(archivePath), { recursive: true });
const response = await fetch(
  `https://github.com/${config.repository}/archive/${config.ref}.tar.gz`,
  { headers: { "User-Agent": "mcl-website-build" } },
);
if (!response.ok) throw new Error(`Unable to download MCL source: HTTP ${response.status}`);
await pipeline(response.body, createWriteStream(archivePath));
await rm(buildDirectory, { recursive: true, force: true });
await mkdir(buildDirectory, { recursive: true });
await run("tar", ["-xzf", archivePath, "--strip-components=1", "-C", buildDirectory]);
await mkdir(runtimeDirectory, { recursive: true });
await run(
  "go",
  [
    "build",
    "-trimpath",
    "-ldflags=-s -w",
    "-o",
    path.join(runtimeDirectory, "mcl.wasm"),
    "./cmd/mcl-wasm",
  ],
  {
    cwd: buildDirectory,
    env: { ...process.env, GOOS: "js", GOARCH: "wasm", CGO_ENABLED: "0" },
  },
);
await run("gzip", ["-9", "-n", "-f", path.join(runtimeDirectory, "mcl.wasm")]);
const goRoot = await capture("go", ["env", "GOROOT"]);
await run("cp", [
  path.join(goRoot.trim(), "lib/wasm/wasm_exec.js"),
  path.join(runtimeDirectory, "wasm_exec.js"),
]);
const publicDirectory = path.join(root, "public");
await mkdir(publicDirectory, { recursive: true });
await cp(runtimeDirectory, publicDirectory, { recursive: true });
await writeFile(stampPath, config.ref);

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", ...options });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} exited with status ${code}`)),
    );
  });
}

function capture(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "inherit"] });
    let output = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => (output += chunk));
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve(output) : reject(new Error(`${command} exited with status ${code}`)),
    );
  });
}
