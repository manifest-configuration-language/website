import { Buffer } from "buffer/index.js";
import path from "path-browserify";
import { validateProjectInput } from "./projectValidation.js";

globalThis.Buffer = Buffer;

let Volume;
let constants;
let started;
let activeVolume;
let workingDirectory = "/mcl-project";

function makeFsAdapter() {
  return new Proxy(
    {
      constants,
      writeSync(fd, bytes) {
        const text = new TextDecoder().decode(bytes);
        (fd === 2 ? console.error : console.log)(text);
        return bytes.length;
      },
    },
    {
      get(target, key) {
        if (key in target) return target[key];
        if (typeof key !== "string") return undefined;
        return (...args) => {
          const callback = args.pop();
          try {
            const operation = activeVolume[`${key}Sync`];
            if (typeof operation !== "function")
              throw Object.assign(new Error(`Unsupported filesystem operation: ${key}`), {
                code: "ENOSYS",
              });
            const result = operation.apply(activeVolume, args);
            if (key === "read" || key === "write") callback(null, result, args[1]);
            else callback(null, result);
          } catch (error) {
            callback(error);
          }
        };
      },
    },
  );
}

globalThis.path = path.posix;
globalThis.process = {
  argv: [],
  env: {},
  pid: 1,
  ppid: 1,
  platform: "browser",
  cwd: () => workingDirectory,
  chdir: (directory) => {
    workingDirectory = path.posix.resolve(workingDirectory, directory);
  },
  getuid: () => 1000,
  getgid: () => 1000,
  geteuid: () => 1000,
  getegid: () => 1000,
  getgroups: () => [1000],
  umask: () => 0o022,
};

function resetFilesystem() {
  activeVolume = new Volume();
  activeVolume.mkdirSync("/mcl-project", { recursive: true });
  workingDirectory = "/mcl-project";
}

async function startRuntime() {
  ({ Volume, constants } = await import("memfs"));
  activeVolume = new Volume();
  globalThis.fs = makeFsAdapter();

  const runtimeURL = new URL("/wasm_exec.js", self.location.href).href;
  await import(/* @vite-ignore */ runtimeURL);
  if (typeof globalThis.Go !== "function")
    throw new Error("The Go WebAssembly runtime did not register a Go constructor.");
  const go = new globalThis.Go();
  const response = await fetch("/mcl.wasm.gz");
  if (!response.ok) throw new Error("Unable to download the MCL WebAssembly runtime.");
  let wasmBody = response.body;
  if (response.headers.get("Content-Encoding")?.toLowerCase() !== "gzip") {
    if (typeof DecompressionStream !== "function")
      throw new Error("This browser does not support gzip decompression for WebAssembly.");
    wasmBody = wasmBody.pipeThrough(new DecompressionStream("gzip"));
  }
  const bytes = await new Response(wasmBody).arrayBuffer();
  const { instance } = await WebAssembly.instantiate(bytes, go.importObject);
  go.run(instance).catch((error) => self.postMessage({ type: "failure", message: String(error) }));
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("The MCL WebAssembly runtime did not expose its API."));
    }, 15000);
    const checkReady = () => {
      if (globalThis.mclWasmReady) {
        clearTimeout(timeout);
        Promise.resolve(globalThis.mclWasmReady).then(resolve, reject);
        return;
      }
      setTimeout(checkReady, 0);
    };
    checkReady();
  });
  if (!globalThis.mclWasm?.run)
    throw new Error("The MCL WebAssembly runtime is missing the run operation.");
}

started = startRuntime();
started.then(
  () => self.postMessage({ type: "ready" }),
  (error) => self.postMessage({ type: "failure", message: String(error) }),
);

self.onmessage = async (event) => {
  const request = event.data;
  if (!validateProjectInput(request?.source, request?.files)) {
    self.postMessage({
      type: "result",
      response: {
        requestId: request?.requestId,
        revision: request?.revision,
        ok: false,
        error: {
          code: "MCL-WASM-INPUT",
          message: "The source or project exceeds the input limits.",
          severity: "error",
          line: 1,
          column: 1,
        },
      },
    });
    return;
  }

  try {
    await started;
    resetFilesystem();
    const response = JSON.parse(globalThis.mclWasm.run(JSON.stringify(request)));
    if (!response.ok && response.error) response.error.severity = "error";
    const yaml = response.result?.yaml ?? "";
    if (new TextEncoder().encode(yaml).byteLength > 1024 * 1024) {
      response.ok = false;
      response.result = undefined;
      response.error = {
        code: "MCL-WASM-OUTPUT",
        message: "Rendered output exceeds the 1 MiB limit.",
        severity: "error",
        line: 1,
        column: 1,
      };
    }
    self.postMessage({ type: "result", response });
  } catch (error) {
    self.postMessage({ type: "failure", message: String(error) });
  }
};
