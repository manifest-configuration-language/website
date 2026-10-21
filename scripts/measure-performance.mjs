import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { stat } from "node:fs/promises";
import { createServer } from "node:net";
import { chromium } from "@playwright/test";

const astroCli = fileURLToPath(new URL("../node_modules/astro/bin/astro.mjs", import.meta.url));
async function reservePort() {
  const listener = createServer();
  await new Promise((resolve, reject) => {
    listener.once("error", reject);
    listener.listen(Number(process.env.PERFORMANCE_PORT ?? 0), "127.0.0.1", resolve);
  });
  const { port } = listener.address();
  await new Promise((resolve, reject) =>
    listener.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

const port = await reservePort();
const origin = `http://127.0.0.1:${port}`;
const server = spawn(
  process.execPath,
  [astroCli, "preview", "--host", "127.0.0.1", "--port", String(port)],
  {
    stdio: "ignore",
    env: { ...process.env, ASTRO_PREVIEW_BACKGROUND: "1" },
  },
);

async function waitForServer() {
  const startedAt = performance.now();
  while (performance.now() - startedAt < 30_000) {
    if (server.exitCode !== null) throw new Error(`Preview server exited with ${server.exitCode}`);
    try {
      const response = await fetch(`${origin}/`);
      if (response.ok) return performance.now() - startedAt;
    } catch {
      // The preview server is still starting.
    }
    await delay(100);
  }
  throw new Error("Preview server did not become ready within 30 seconds");
}

function totals(assets) {
  const result = { html: 0, javascript: 0, css: 0, other: 0 };
  for (const asset of assets.values()) result[asset.category] += asset.bytes;
  return { ...result, total: Object.values(result).reduce((sum, bytes) => sum + bytes, 0) };
}

async function measurePage(
  browser,
  pathname,
  { renderPlayground = false, measureSearch = false } = {},
) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const assets = new Map();
  const responseTasks = [];
  context.on("response", async (response) => {
    const task = (async () => {
      const request = response.request();
      if (!response.ok()) return;
      try {
        const body = await response.body();
        const url = new URL(response.url());
        if (url.origin === origin) {
          const type = request.resourceType();
          const category =
            type === "document"
              ? "html"
              : type === "script"
                ? "javascript"
                : type === "stylesheet"
                  ? "css"
                  : "other";
          assets.set(url.pathname, { bytes: body.byteLength, category });
        }
      } catch {
        // A response may be canceled during navigation.
      }
    })();
    responseTasks.push(task);
  });

  await page.addInitScript(() => {
    Reflect.set(window, "__performanceLcp", 0);
    Reflect.set(window, "__performanceCls", 0);
    new PerformanceObserver((entries) => {
      for (const entry of entries.getEntries()) {
        Reflect.set(window, "__performanceLcp", entry.startTime);
      }
    }).observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver((entries) => {
      for (const entry of entries.getEntries()) {
        if (!entry.hadRecentInput) {
          Reflect.set(
            window,
            "__performanceCls",
            Number(Reflect.get(window, "__performanceCls")) + entry.value,
          );
        }
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
  const navigationStartedAt = performance.now();
  await page.goto(`${origin}${pathname}`, { waitUntil: "load" });
  await Promise.all(responseTasks);
  const loadMs = performance.now() - navigationStartedAt;
  await page.waitForTimeout(200);
  await Promise.all(responseTasks);
  const initialAssets = new Map(assets);
  const browserTimingProxies = await page.evaluate(() => ({
    firstContentfulPaintMs: Math.round(
      performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? 0,
    ),
    largestContentfulPaintMs: Math.round(Number(Reflect.get(window, "__performanceLcp")) || 0),
    cumulativeLayoutShift: Number(
      (Number(Reflect.get(window, "__performanceCls")) || 0).toFixed(4),
    ),
  }));
  let pagefindOnDemandAssets;
  if (measureSearch) {
    await page.getByRole("button", { name: "検索" }).click();
    await page.getByRole("dialog").waitFor({ state: "visible" });
    await page.waitForTimeout(500);
    await Promise.all(responseTasks);
    pagefindOnDemandAssets = totals(
      new Map([...assets].filter(([url]) => !initialAssets.has(url))),
    );
  }
  let renderMs;
  let secondRenderMs;
  if (renderPlayground) {
    const renderStartedAt = performance.now();
    await page.getByRole("button", { name: "実行" }).click();
    await page.getByLabel("レンダリング結果").waitFor({ state: "visible", timeout: 30_000 });
    renderMs = performance.now() - renderStartedAt;
    const secondStartedAt = performance.now();
    await page.getByRole("button", { name: "実行" }).click();
    await page.getByRole("button", { name: "中断" }).waitFor({ state: "visible" });
    await page.getByRole("button", { name: "実行" }).waitFor({ state: "visible" });
    await page.getByLabel("レンダリング結果").waitFor({ state: "visible", timeout: 30_000 });
    secondRenderMs = performance.now() - secondStartedAt;
    assets.set("/mcl.wasm.gz", {
      bytes: (await stat(new URL("../.build/dist/mcl.wasm.gz", import.meta.url))).size,
      category: "other",
    });
  }
  await page.waitForTimeout(200);
  const result = {
    path: pathname,
    navigationLoadMs: Math.round(loadMs),
    browserTimingProxies,
    initialAssets: totals(initialAssets),
    ...(pagefindOnDemandAssets === undefined ? {} : { pagefindOnDemandAssets }),
    ...(renderMs === undefined
      ? {}
      : {
          wasmStartupAndFirstRenderMs: Math.round(renderMs),
          secondRenderMs: Math.round(secondRenderMs),
          afterExecutionAssets: totals(
            new Map([...assets].filter(([url]) => !initialAssets.has(url))),
          ),
          wasmLoadedOnExecution: true,
        }),
    wasmIncludedInInitialAssets: [...initialAssets.keys()].some((url) => url.includes("mcl.wasm")),
    codeMirrorEditorPresent: (await page.locator(".cm-editor").count()) > 0,
    assets: Object.fromEntries(
      [...assets.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([url, asset]) => [url, asset.bytes]),
    ),
  };
  await context.close();
  return result;
}

async function measureCancellation(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  let notifyWasmRequest;
  const wasmRequested = new Promise((resolve) => (notifyWasmRequest = resolve));
  let releaseWasmRequest;
  const wasmHeld = new Promise((resolve) => (releaseWasmRequest = resolve));
  await context.route("**/mcl.wasm.gz", async (route) => {
    notifyWasmRequest();
    await wasmHeld;
    await route.continue();
  });
  try {
    await page.goto(`${origin}/playground/`, { waitUntil: "load" });
    await page.getByRole("button", { name: "実行" }).click();
    await wasmRequested;
    const startedAt = performance.now();
    await page.getByRole("button", { name: "中断" }).click();
    await page.getByRole("button", { name: "実行" }).waitFor({ state: "visible" });
    return Math.round(performance.now() - startedAt);
  } finally {
    releaseWasmRequest();
    await context.close();
  }
}

async function measureLargeProject(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${origin}/playground/`, { waitUntil: "load" });

  const projectBytes = 15.9 * 1024 * 1024;
  const source = `let appName = "catalog"
let configMap =
  apiVersion: "v1"
  kind: "ConfigMap"
  metadata:
    name: appName
  data:
    mode: "development"

emit configMap
`;
  const importStartedAt = performance.now();
  await page.locator('input[aria-label="MCLプロジェクトフォルダー"]').evaluate(
    (input, { fileSize, source }) => {
      const root = "large-project";
      const files = [
        new File([source], "main.mcl", { type: "text/plain" }),
        new File([new Uint8Array(fileSize)], "payload-a.bin"),
        new File([new Uint8Array(fileSize)], "payload-b.bin"),
      ];
      for (const [index, file] of files.entries()) {
        const name = index === 0 ? "main.mcl" : `payload-${index === 1 ? "a" : "b"}.bin`;
        Object.defineProperty(file, "webkitRelativePath", { value: `${root}/${name}` });
      }
      const transfer = new DataTransfer();
      files.forEach((file) => transfer.items.add(file));
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    },
    { fileSize: projectBytes, source },
  );
  try {
    await page
      .locator(".playground-toolbar span")
      .filter({ hasText: "2 files · 31.8 / 32" })
      .waitFor({ timeout: 10_000 });
  } catch (error) {
    const playgroundText = await page.locator(".playground").innerText();
    throw new Error(`Large project import failed: ${playgroundText}`, { cause: error });
  }
  const projectImportMs = Math.round(performance.now() - importStartedAt);

  const renderStartedAt = performance.now();
  await page.getByRole("button", { name: "実行" }).click();
  const evaluationResult = await page
    .waitForFunction(
      () => {
        if (document.querySelector('[aria-label="レンダリング結果"]'))
          return { status: "rendered" };
        const alert = document.querySelector(".playground [role=alert]");
        return alert ? { status: "error", message: alert.textContent?.trim() } : false;
      },
      null,
      { timeout: 60_000 },
    )
    .then((handle) => handle.jsonValue())
    .catch(() => ({ status: "timeout" }));
  const evaluationMs = Math.round(performance.now() - renderStartedAt);
  await context.close();
  if (evaluationResult.status !== "rendered")
    throw new Error(`31.8 MiB binary project did not render: ${JSON.stringify(evaluationResult)}`);

  return {
    acceptedProjectBytes: Math.round(projectBytes * 2),
    fileCount: 3,
    projectImportMs,
    evaluationMs,
    evaluationResult,
  };
}

let browser;
try {
  const startupMs = await waitForServer();
  browser = await chromium.launch({ headless: true });
  const measurements = [
    await measurePage(browser, "/reference/language/", { measureSearch: true }),
    await measurePage(browser, "/playground/", { renderPlayground: true }),
  ];
  const cancellationUiLatencyMs = await measureCancellation(browser);
  const largeProject = await measureLargeProject(browser);
  console.log(
    JSON.stringify(
      {
        measuredAt: new Date().toISOString(),
        node: process.version,
        platform: `${process.platform}-${process.arch}`,
        chromium: browser.version(),
        previewReadyMs: Math.round(startupMs),
        cancellationUiLatencyMs,
        largeProject,
        measurements,
      },
      null,
      2,
    ),
  );
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
