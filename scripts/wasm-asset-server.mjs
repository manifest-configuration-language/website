import { createServer } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const assetDirectory = path.resolve(import.meta.dirname, "../.build/dist/_astro");

export async function startWasmAssetServer() {
  const assetName = (await readdir(assetDirectory)).find((name) =>
    /^mcl\.wasm-[A-Za-z0-9_-]{8,}\.wasm\.gz$/.test(name),
  );
  if (!assetName) throw new Error("The fingerprinted MCL WebAssembly asset is missing.");
  const requestName = assetName.replace(/\.gz$/, "");
  const bytes = await readFile(path.join(assetDirectory, assetName));
  const server = createServer((request, response) => {
    const requestedAsset = new URL(request.url ?? "/", "http://localhost").pathname.slice(1);
    if (requestedAsset !== requestName) {
      response.writeHead(404).end();
      return;
    }

    response.writeHead(200, {
      "access-control-allow-origin": "*",
      "cache-control": "public, max-age=31536000, immutable",
      "content-encoding": "gzip",
      "content-length": String(bytes.byteLength),
      "content-type": "application/wasm",
      vary: "Accept-Encoding",
    });
    response.end(bytes);
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("WASM asset server failed to bind.");

  return {
    assetName,
    requestName,
    byteLength: bytes.byteLength,
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
