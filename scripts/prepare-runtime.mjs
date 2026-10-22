import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";

const root = path.resolve(import.meta.dirname, "..");
const config = JSON.parse(await readFile(path.join(root, "mcl-runtime.json"), "utf8"));
const buildDirectory = path.join(root, ".build/mcl-core");
const archivePath = path.join(root, ".build/mcl-core.tar.gz");
const runtimeDirectory = path.join(root, ".build/runtime");
const sourceRuntimeDirectory = path.join(root, "src/playground/runtime");
const stampPath = path.join(root, ".build/mcl-runtime-stamp.json");
const buildFlags = ["-trimpath", "-ldflags=-s -w"];
const gzipOptions = { level: 9, mtime: 0 };
const buildTarget = "./cmd/mcl-wasm";
const wasmEnvironment = {
  GOOS: "js",
  GOARCH: "wasm",
  CGO_ENABLED: "0",
};

const [goVersion, goRoot, goBuildSettings, scriptSource] = await Promise.all([
  capture("go", ["version"]),
  capture("go", ["env", "GOROOT"]),
  capture("go", ["env", "GOFLAGS", "GOEXPERIMENT", "GOTOOLCHAIN"]),
  readFile(import.meta.filename),
]);
const wasmExecPath = path.join(goRoot.trim(), "lib/wasm/wasm_exec.js");
const wasmExecHash = hash(await readFile(wasmExecPath));
const fingerprint = hash(
  JSON.stringify({
    repository: config.repository,
    ref: config.ref,
    goVersion: goVersion.trim(),
    goBuildSettings: goBuildSettings.trim().split("\n"),
    nodeVersion: process.version,
    zlibVersion: process.versions.zlib,
    wasmEnvironment,
    buildFlags,
    buildTarget,
    gzipOptions,
    wasmExecHash,
    scriptHash: hash(scriptSource),
  }),
);

let cacheHit = false;
try {
  const stamp = JSON.parse(await readFile(stampPath, "utf8"));
  const outputs = await outputHashes();
  if (
    stamp.fingerprint === fingerprint &&
    JSON.stringify(stamp.outputs) === JSON.stringify(outputs)
  ) {
    cacheHit = true;
  }
} catch {}

if (cacheHit) {
  console.log("MCL runtime fingerprint matches; skipping the build.");
} else {
  await rebuildRuntime();
}

async function rebuildRuntime() {
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
    ["build", ...buildFlags, "-o", path.join(runtimeDirectory, "mcl.wasm"), buildTarget],
    {
      cwd: buildDirectory,
      env: { ...process.env, ...wasmEnvironment },
    },
  );
  const wasmPath = path.join(runtimeDirectory, "mcl.wasm");
  await writeFile(`${wasmPath}.gz`, gzipSync(await readFile(wasmPath), gzipOptions));
  await rm(wasmPath);
  await cp(wasmExecPath, path.join(runtimeDirectory, "wasm_exec.js"));
  await rm(sourceRuntimeDirectory, { recursive: true, force: true });
  await mkdir(sourceRuntimeDirectory, { recursive: true });
  await cp(runtimeDirectory, sourceRuntimeDirectory, { recursive: true });
  await rm(path.join(root, "public/mcl.wasm.gz"), { force: true });
  await rm(path.join(root, "public/wasm_exec.js"), { force: true });
  await writeFile(stampPath, `${JSON.stringify({ fingerprint, outputs: await outputHashes() })}\n`);
}

async function outputHashes() {
  const [wasm, wasmExec] = await Promise.all([
    readFile(path.join(sourceRuntimeDirectory, "mcl.wasm.gz")),
    readFile(path.join(sourceRuntimeDirectory, "wasm_exec.js")),
  ]);

  return { wasm: hash(wasm), wasmExec: hash(wasmExec) };
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

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
    child.once("close", (code) =>
      code === 0 ? resolve(output) : reject(new Error(`${command} exited with status ${code}`)),
    );
  });
}
