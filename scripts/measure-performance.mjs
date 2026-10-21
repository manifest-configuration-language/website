import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { stat } from "node:fs/promises";
import { chromium } from "@playwright/test";

const port = Number(process.env.PERFORMANCE_PORT ?? 4323);
const origin = `http://127.0.0.1:${port}`;
const astroCli = fileURLToPath(new URL("../node_modules/astro/bin/astro.mjs", import.meta.url));
const server = spawn(
  process.execPath,
  [astroCli, "preview", "--host", "127.0.0.1", "--port", String(port)],
  {
    stdio: "ignore",
    env: process.env,
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

async function measurePage(browser, pathname, renderPlayground = false) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const assets = new Map();
  context.on("response", async (response) => {
    const request = response.request();
    if (request.resourceType() === "document" || !response.ok()) return;
    try {
      const body = await response.body();
      const url = new URL(response.url());
      if (url.origin === origin) assets.set(url.pathname, body.byteLength);
    } catch {
      // A response may be canceled during navigation.
    }
  });

  const navigationStartedAt = performance.now();
  await page.goto(`${origin}${pathname}`, { waitUntil: "load" });
  const loadMs = performance.now() - navigationStartedAt;
  let renderMs;
  if (renderPlayground) {
    const renderStartedAt = performance.now();
    await page.getByRole("button", { name: "実行" }).click();
    await page.getByLabel("レンダリング結果").waitFor({ state: "visible", timeout: 30_000 });
    renderMs = performance.now() - renderStartedAt;
    assets.set(
      "/mcl.wasm.gz",
      (await stat(new URL("../.build/dist/mcl.wasm.gz", import.meta.url))).size,
    );
  }
  await page.waitForTimeout(200);
  const result = {
    path: pathname,
    navigationLoadMs: Math.round(loadMs),
    ...(renderMs === undefined ? {} : { playgroundRenderMs: Math.round(renderMs) }),
    assetBytes: [...assets.values()].reduce((total, bytes) => total + bytes, 0),
    assets: Object.fromEntries([...assets.entries()].sort(([a], [b]) => a.localeCompare(b))),
  };
  await context.close();
  return result;
}

let browser;
try {
  const startupMs = await waitForServer();
  browser = await chromium.launch({ headless: true });
  const measurements = [
    await measurePage(browser, "/reference/language/"),
    await measurePage(browser, "/playground/", true),
  ];
  console.log(
    JSON.stringify(
      {
        measuredAt: new Date().toISOString(),
        node: process.version,
        platform: `${process.platform}-${process.arch}`,
        chromium: browser.version(),
        previewReadyMs: Math.round(startupMs),
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
