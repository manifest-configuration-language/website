import type { Page } from "@playwright/test";
import { startWasmAssetServer } from "../scripts/wasm-asset-server.mjs";

let assetServer: Awaited<ReturnType<typeof startWasmAssetServer>> | undefined;

async function ensureWasmServer() {
  assetServer ??= await startWasmAssetServer();
  return assetServer;
}

export async function addWasmAssetHeaders(page: Page) {
  const wasmServer = await ensureWasmServer();
  await page.route("**/mcl-*.wasm", (route) => {
    const requestName = new URL(route.request().url()).pathname.split("/").at(-1);
    if (requestName !== wasmServer.requestName) return route.continue();
    return route.continue({ url: `${wasmServer.url}/${wasmServer.requestName}` });
  });
}

export async function closeWasmAssetServer() {
  if (!assetServer) return;
  await assetServer.close();
  assetServer = undefined;
}
