import type { Page } from "@playwright/test";
import { startWasmAssetServer } from "../scripts/wasm-asset-server.mjs";

let assetServer: Awaited<ReturnType<typeof startWasmAssetServer>> | undefined;

async function ensureWasmServer() {
  assetServer ??= await startWasmAssetServer();
  return assetServer;
}

export async function addWasmAssetHeaders(page: Page) {
  const wasmServer = await ensureWasmServer();
  await page.route("**/mcl.wasm-*.gz", (route) => {
    const assetName = new URL(route.request().url()).pathname.split("/").at(-1);
    if (assetName !== wasmServer.assetName) return route.continue();
    return route.continue({ url: `${wasmServer.url}/${wasmServer.assetName}` });
  });
}

export async function closeWasmAssetServer() {
  if (!assetServer) return;
  await assetServer.close();
  assetServer = undefined;
}
