import { spawn } from "node:child_process";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { createServer, request as httpRequest } from "node:http";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { createServer as createNetServer } from "node:net";
import { chromium } from "@playwright/test";

const astroCli = fileURLToPath(new URL("../node_modules/astro/bin/astro.mjs", import.meta.url));
const assetBudgets = JSON.parse(
  await readFile(new URL("./performance-budget.json", import.meta.url), "utf8"),
);
const assetBudgetNames = [
  "referenceInitialAssetsBytes",
  "playgroundInitialAssetsBytes",
  "referenceSearchAssetsBytes",
  "playgroundExecutionAssetsBytes",
];
const runtimeBudgetNames = [
  "referenceNavigationLoadMs",
  "referenceSearchMs",
  "playgroundNavigationLoadMs",
  "playgroundFirstRenderMs",
  "playgroundWasmInstantiateMs",
  "playgroundSecondRenderMs",
  "cancellationUiLatencyMs",
  "largeProjectImportMs",
  "largeProjectEvaluationMs",
  "largeProjectWasmMemoryBytes",
  "referenceLargestContentfulPaintMs",
  "referenceCumulativeLayoutShift",
  "referenceInteractionLatencyProxyMs",
];
const allBudgetNames = [...assetBudgetNames, ...runtimeBudgetNames];
const captureArgument = process.argv.find((argument) => argument.startsWith("--record-baseline"));
const capturePath = captureArgument
  ? captureArgument.includes("=")
    ? captureArgument.slice(captureArgument.indexOf("=") + 1)
    : "scripts/performance-baseline.candidate.json"
  : null;
if (
  captureArgument &&
  (capturePath.length === 0 ||
    process.argv.filter((arg) => arg.startsWith("--record-baseline")).length > 1)
)
  throw new Error("Use --record-baseline[=<output-path>] once.");
if (
  Object.keys(assetBudgets).length !== allBudgetNames.length + 1 ||
  allBudgetNames.some((name) => !Number.isFinite(assetBudgets[name]) || assetBudgets[name] <= 0) ||
  !assetBudgets.baselineTolerance ||
  Object.keys(assetBudgets.baselineTolerance).length !== allBudgetNames.length ||
  allBudgetNames.some((name) => {
    const tolerance = assetBudgets.baselineTolerance[name];
    return (
      !tolerance ||
      !Number.isFinite(tolerance.relative) ||
      tolerance.relative < 0 ||
      !Number.isFinite(tolerance.absolute) ||
      tolerance.absolute < 0
    );
  })
)
  throw new Error("The performance budget configuration is invalid.");
const baselinePath = new URL("./performance-baseline.json", import.meta.url);
let performanceBaseline;
if (!capturePath) {
  performanceBaseline = JSON.parse(await readFile(baselinePath, "utf8"));
  if (
    performanceBaseline.schemaVersion !== 1 ||
    !performanceBaseline.environment ||
    !performanceBaseline.measurements ||
    allBudgetNames.some((name) => !Number.isFinite(performanceBaseline.measurements[name]))
  )
    throw new Error("The committed performance baseline is invalid.");
}
async function reservePort(requestedPort = 0) {
  const listener = createNetServer();
  await new Promise((resolve, reject) => {
    listener.once("error", reject);
    listener.listen(requestedPort, "127.0.0.1", resolve);
  });
  const { port } = listener.address();
  await new Promise((resolve, reject) =>
    listener.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

const port = await reservePort(Number(process.env.PERFORMANCE_PORT ?? 0));
const previewPort = await reservePort();
const origin = `http://127.0.0.1:${port}`;
const wasmAssetDirectory = new URL("../.build/dist/_astro/", import.meta.url);
const wasmAssetName = (await readdir(wasmAssetDirectory)).find((name) =>
  /^mcl\.wasm-[A-Za-z0-9_-]{8,}\.gz$/.test(name),
);
if (!wasmAssetName) throw new Error("The fingerprinted MCL WebAssembly asset is missing.");
const wasmAssetPath = `/_astro/${wasmAssetName.replace(/\.gz$/, ".wasm")}`;
const wasmAssetBytes = await readFile(new URL(wasmAssetName, wasmAssetDirectory));
const workerInstrumentation = `**/playground.worker-*.js`;
const server = spawn(
  process.execPath,
  [astroCli, "preview", "--host", "127.0.0.1", "--port", String(previewPort)],
  {
    stdio: "ignore",
    env: { ...process.env, ASTRO_PREVIEW_BACKGROUND: "1" },
  },
);
const proxyServer = createServer((request, response) => {
  if (new URL(request.url ?? "/", origin).pathname === wasmAssetPath) {
    response.writeHead(200, {
      "cache-control": "public, max-age=31536000, immutable",
      "content-encoding": "gzip",
      "content-length": String(wasmAssetBytes.byteLength),
      "content-type": "application/wasm",
      vary: "Accept-Encoding",
    });
    response.end(wasmAssetBytes);
    return;
  }

  const upstream = httpRequest(
    {
      hostname: "127.0.0.1",
      port: previewPort,
      path: request.url,
      method: request.method,
      headers: { ...request.headers, host: `127.0.0.1:${previewPort}` },
    },
    (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
      upstreamResponse.pipe(response);
    },
  );
  upstream.on("error", () => {
    response.writeHead(502);
    response.end();
  });
  request.pipe(upstream);
});
await new Promise((resolve, reject) => {
  proxyServer.once("error", reject);
  proxyServer.listen(port, "127.0.0.1", resolve);
}).catch((error) => {
  server.kill("SIGTERM");
  throw error;
});

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

async function instrumentWasmWorker(context) {
  await context.route(workerInstrumentation, async (route) => {
    const response = await route.fetch();
    const source = await response.text();
    const instantiateCall = /WebAssembly\.instantiateStreaming\(([^,]+),([^)]*)\)/g;
    const matches = [...source.matchAll(instantiateCall)];
    if (matches.length !== 1)
      throw new Error(
        `Expected one WebAssembly.instantiateStreaming call in ${route.request().url()}`,
      );
    const instrumented = source.replace(
      instantiateCall,
      "(globalThis.__mclWasmInstantiateStartedAt=performance.now(),WebAssembly.instantiateStreaming($1,$2).then(result=>{globalThis.__mclWasmInstantiateMs=performance.now()-globalThis.__mclWasmInstantiateStartedAt;globalThis.__mclWasmMemoryAtInstantiationBytes=result.instance.exports.mem?.buffer.byteLength??null;globalThis.__mclWasmMemory=result.instance.exports.mem??null;return result}))",
    );
    const headers = { ...response.headers() };
    delete headers["content-encoding"];
    delete headers["content-length"];
    await route.fulfill({ response, body: instrumented, headers });
  });
}

async function wasmWorkerMetrics(page) {
  const worker = page.workers().find((candidate) => candidate.url().includes("playground.worker-"));
  if (!worker) return null;
  return worker.evaluate(() => ({
    wasmStreamingInstantiateMs: Number.isFinite(globalThis.__mclWasmInstantiateMs)
      ? Math.round(globalThis.__mclWasmInstantiateMs)
      : null,
    wasmLinearMemoryBytesAfterInstantiation: globalThis.__mclWasmMemoryAtInstantiationBytes ?? null,
    wasmLinearMemoryCurrentBytes: globalThis.__mclWasmMemory?.buffer.byteLength ?? null,
  }));
}

async function measurePage(
  browser,
  pathname,
  { renderPlayground = false, measureSearch = false } = {},
) {
  const context = await browser.newContext();
  await instrumentWasmWorker(context);
  const page = await context.newPage();
  const assets = new Map();
  const responseTasks = [];
  context.on("response", async (response) => {
    const task = (async () => {
      const request = response.request();
      if (!response.ok()) return;
      try {
        const url = new URL(response.url());
        if (url.origin !== origin) return;
        if (url.pathname === wasmAssetPath) {
          assets.set(url.pathname, {
            bytes: wasmAssetBytes.byteLength,
            category: "other",
          });
          return;
        }
        const body = await response.body();
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
      } catch {
        // A response may be canceled during navigation.
      }
    })();
    responseTasks.push(task);
  });

  await page.addInitScript(() => {
    Reflect.set(window, "__performanceLcp", 0);
    Reflect.set(window, "__performanceCls", 0);
    Reflect.set(window, "__performanceInteractions", []);
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
    if (PerformanceObserver.supportedEntryTypes.includes("event")) {
      new PerformanceObserver((entries) => {
        const interactions = Reflect.get(window, "__performanceInteractions");
        for (const entry of entries.getEntries()) {
          if (entry.interactionId > 0) {
            interactions.push({
              duration: entry.duration,
              interactionId: entry.interactionId,
              name: entry.name,
            });
          }
        }
      }).observe({ type: "event", buffered: true, durationThreshold: 16 });
    }
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
  let pagefindFirstSearchMs;
  if (measureSearch) {
    const searchStartedAt = performance.now();
    await page.getByRole("button", { name: "検索" }).click();
    const searchDialog = page.getByRole("dialog", { name: "検索" });
    await searchDialog.waitFor({ state: "visible" });
    await searchDialog.locator("input").fill("型");
    await searchDialog.getByRole("link", { name: /型/ }).first().waitFor({ state: "visible" });
    pagefindFirstSearchMs = Math.round(performance.now() - searchStartedAt);
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
    assets.set(wasmAssetPath, { bytes: wasmAssetBytes.byteLength, category: "other" });
  }
  const wasmMetrics = renderPlayground ? await wasmWorkerMetrics(page) : null;
  await page.waitForTimeout(200);
  const result = {
    path: pathname,
    navigationLoadMs: Math.round(loadMs),
    browserTimingProxies,
    interactionLatencyProxy: await page.evaluate(() => {
      const interactions = Reflect.get(window, "__performanceInteractions");
      const durations = new Map();
      for (const entry of interactions) {
        const current = durations.get(entry.interactionId);
        if (!current || entry.duration > current.duration) {
          durations.set(entry.interactionId, { duration: entry.duration, name: entry.name });
        }
      }
      const longest = [...durations.values()].sort(
        (left, right) => right.duration - left.duration,
      )[0];
      return {
        observedInteractionCount: durations.size,
        maxObservedInteractionMs: longest ? Math.round(longest.duration) : null,
        maxObservedInteractionEvent: longest?.name ?? null,
      };
    }),
    initialAssets: totals(initialAssets),
    ...(pagefindOnDemandAssets === undefined ? {} : { pagefindOnDemandAssets }),
    ...(pagefindFirstSearchMs === undefined ? {} : { pagefindFirstSearchMs }),
    ...(renderMs === undefined
      ? {}
      : {
          wasmStartupAndFirstRenderMs: Math.round(renderMs),
          wasmStreamingInstantiateMs: wasmMetrics?.wasmStreamingInstantiateMs ?? null,
          wasmLinearMemoryBytesAfterInstantiation:
            wasmMetrics?.wasmLinearMemoryBytesAfterInstantiation ?? null,
          wasmLinearMemoryBytesAfterFirstRender: wasmMetrics?.wasmLinearMemoryCurrentBytes ?? null,
          secondRenderMs: Math.round(secondRenderMs),
          afterExecutionAssets: totals(
            new Map([...assets].filter(([url]) => !initialAssets.has(url))),
          ),
          wasmLoadedOnExecution: true,
        }),
    wasmIncludedInInitialAssets: [...initialAssets.keys()].some((url) => url.includes(".wasm-")),
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
  await context.route("**/mcl.wasm-*.wasm", async (route) => {
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
  await instrumentWasmWorker(context);
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
  const wasmMetrics = await wasmWorkerMetrics(page);
  await context.close();
  if (evaluationResult.status !== "rendered")
    throw new Error(`31.8 MiB binary project did not render: ${JSON.stringify(evaluationResult)}`);

  return {
    acceptedProjectBytes: Math.round(projectBytes * 2),
    fileCount: 3,
    projectImportMs,
    evaluationMs,
    wasmLinearMemoryBytesAfterLargeProject: wasmMetrics?.wasmLinearMemoryCurrentBytes ?? null,
    evaluationResult,
  };
}

let browser;
try {
  const startupMs = await waitForServer();
  browser = await chromium.launch({ headless: true });
  const measurements = [
    await measurePage(browser, "/reference/", { measureSearch: true }),
    await measurePage(browser, "/playground/", { renderPlayground: true }),
  ];
  const cancellationUiLatencyMs = await measureCancellation(browser);
  const largeProject = await measureLargeProject(browser);
  const assetBudgetMeasurements = {
    referenceInitialAssetsBytes: measurements[0].initialAssets.total,
    playgroundInitialAssetsBytes: measurements[1].initialAssets.total,
    referenceSearchAssetsBytes: measurements[0].pagefindOnDemandAssets.total,
    playgroundExecutionAssetsBytes: measurements[1].afterExecutionAssets.total,
  };
  const runtimeBudgetMeasurements = {
    referenceNavigationLoadMs: measurements[0].navigationLoadMs,
    referenceSearchMs: measurements[0].pagefindFirstSearchMs,
    playgroundNavigationLoadMs: measurements[1].navigationLoadMs,
    playgroundFirstRenderMs: measurements[1].wasmStartupAndFirstRenderMs,
    playgroundWasmInstantiateMs: measurements[1].wasmStreamingInstantiateMs,
    playgroundSecondRenderMs: measurements[1].secondRenderMs,
    cancellationUiLatencyMs,
    largeProjectImportMs: largeProject.projectImportMs,
    largeProjectEvaluationMs: largeProject.evaluationMs,
    largeProjectWasmMemoryBytes: largeProject.wasmLinearMemoryBytesAfterLargeProject,
    referenceLargestContentfulPaintMs:
      measurements[0].browserTimingProxies.largestContentfulPaintMs,
    referenceCumulativeLayoutShift: measurements[0].browserTimingProxies.cumulativeLayoutShift,
    referenceInteractionLatencyProxyMs:
      measurements[0].interactionLatencyProxy.maxObservedInteractionMs,
  };
  const findViolations = (names, measurementsByName) =>
    names.flatMap((name) => {
      const limit = assetBudgets[name];
      const measured = measurementsByName[name];
      return Number.isFinite(measured) && measured <= limit
        ? []
        : [{ limit, measured, metric: name }];
    });
  const assetBudgetViolations = findViolations(assetBudgetNames, assetBudgetMeasurements);
  const runtimeBudgetViolations = findViolations(runtimeBudgetNames, runtimeBudgetMeasurements);
  const baselineMeasurements = { ...assetBudgetMeasurements, ...runtimeBudgetMeasurements };
  const incompatibleBaselineMetrics =
    performanceBaseline &&
    performanceBaseline.environment.platform !== `${process.platform}-${process.arch}`
      ? runtimeBudgetNames
      : [];
  const baselineComparisonViolations = performanceBaseline
    ? allBudgetNames.flatMap((metric) => {
        if (incompatibleBaselineMetrics.includes(metric)) return [];
        const baseline = performanceBaseline.measurements[metric];
        const measured = baselineMeasurements[metric];
        const tolerance = assetBudgets.baselineTolerance[metric];
        const allowedIncrease = Math.max(baseline * tolerance.relative, tolerance.absolute);
        return Number.isFinite(measured) && measured <= baseline + allowedIncrease
          ? []
          : [
              {
                baseline,
                allowedIncrease,
                limit: baseline + allowedIncrease,
                measured,
                metric,
              },
            ];
      })
    : [];
  const budgetViolations = [
    ...assetBudgetViolations,
    ...runtimeBudgetViolations,
    ...baselineComparisonViolations,
  ];
  const report = {
    measuredAt: new Date().toISOString(),
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    chromium: browser.version(),
    previewReadyMs: Math.round(startupMs),
    cancellationUiLatencyMs,
    largeProject,
    measurements,
    assetBudget: {
      status: assetBudgetViolations.length === 0 ? "pass" : "fail",
      limits: Object.fromEntries(assetBudgetNames.map((name) => [name, assetBudgets[name]])),
      measurements: assetBudgetMeasurements,
      violations: assetBudgetViolations,
    },
    runtimeBudget: {
      status: runtimeBudgetViolations.length === 0 ? "pass" : "fail",
      limits: Object.fromEntries(runtimeBudgetNames.map((name) => [name, assetBudgets[name]])),
      measurements: runtimeBudgetMeasurements,
      violations: runtimeBudgetViolations,
    },
    baselineComparison: capturePath
      ? { status: "capture", source: capturePath }
      : {
          status:
            baselineComparisonViolations.length > 0
              ? "fail"
              : incompatibleBaselineMetrics.length > 0
                ? "partial"
                : "pass",
          capturedAt: performanceBaseline.measuredAt,
          environment: performanceBaseline.environment,
          comparedMetrics: allBudgetNames.filter(
            (metric) => !incompatibleBaselineMetrics.includes(metric),
          ),
          skippedForPlatformMismatch: incompatibleBaselineMetrics,
          tolerances: assetBudgets.baselineTolerance,
          baseline: performanceBaseline.measurements,
          measurements: baselineMeasurements,
          violations: baselineComparisonViolations,
        },
    performanceBudget: {
      status: budgetViolations.length === 0 ? "pass" : "fail",
      violations: budgetViolations,
    },
  };
  if (capturePath && budgetViolations.length === 0) {
    const baselineCandidate = {
      schemaVersion: 1,
      measuredAt: report.measuredAt,
      environment: { node: report.node, platform: report.platform, chromium: report.chromium },
      measurements: baselineMeasurements,
    };
    await writeFile(capturePath, `${JSON.stringify(baselineCandidate, null, 2)}\n`);
  }
  console.log(JSON.stringify(report, null, 2));
  if (budgetViolations.length > 0) {
    process.exitCode = 1;
    console.error(`Performance budgets exceeded: ${JSON.stringify(budgetViolations)}`);
  }
} finally {
  try {
    await browser?.close();
  } finally {
    if (server.exitCode === null) {
      server.kill("SIGTERM");
      await Promise.race([
        new Promise((resolve) => server.once("exit", resolve)),
        delay(5_000).then(() => server.kill("SIGKILL")),
      ]);
    }
    await new Promise((resolve, reject) =>
      proxyServer.close((error) => (error ? reject(error) : resolve())),
    );
  }
}
