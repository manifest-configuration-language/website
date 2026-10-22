import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { request as httpRequest } from "node:http";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { expect, test } from "@playwright/test";

const execFileAsync = promisify(execFile);
const containerImage = process.env.PRODUCTION_CONTAINER_IMAGE;
const wasmAssetPath = /\/_astro\/mcl-[A-Za-z0-9_-]{8,}\.wasm$/;

async function startContainer(image: string) {
  const { stdout } = await execFileAsync("docker", [
    "run",
    "--detach",
    "--read-only",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges",
    "--user",
    "10001:10001",
    "--tmpfs",
    "/tmp:rw,noexec,nosuid,size=16m",
    "--publish",
    "127.0.0.1::8080",
    image,
  ]);
  const containerId = stdout.trim();
  const port = await execFileAsync("docker", ["port", containerId, "8080/tcp"]);
  const portNumber = port.stdout.trim().split(":").at(-1);
  if (!portNumber || !/^\d+$/.test(portNumber)) {
    await execFileAsync("docker", ["rm", "--force", containerId]);
    throw new Error(`Docker did not report a published HTTP port: ${port.stdout}`);
  }
  return { containerId, baseURL: `http://127.0.0.1:${portNumber}` };
}

function getEncodedAsset(url: string, acceptEncoding: string) {
  return new Promise<{
    status: number;
    headers: import("node:http").IncomingHttpHeaders;
    body: Buffer;
  }>((resolve, reject) => {
    const request = httpRequest(url, { headers: { "accept-encoding": acceptEncoding } }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () =>
        resolve({
          status: response.statusCode ?? 0,
          headers: response.headers,
          body: Buffer.concat(chunks),
        }),
      );
    });
    request.once("error", reject);
    request.end();
  });
}

async function expectCompressed(url: string, contentType: RegExp, encoding: string) {
  const response = await getEncodedAsset(url, encoding);
  expect(response.status).toBe(200);
  expect(response.headers["content-type"]).toMatch(contentType);
  expect(response.headers["content-encoding"]).toMatch(/^(?:br|gzip)$/);
  expect(response.headers.vary).toMatch(/(?:^|,)\s*accept-encoding\s*(?:,|$)/i);
}

function decodeWasm(body: Buffer, encoding?: string) {
  if (encoding === "br") return brotliDecompressSync(body);
  if (encoding === "gzip") return gunzipSync(body);
  return body;
}

test("serves and runs the production site in a hardened Caddy container", async ({ page }) => {
  test.skip(!containerImage, "Set PRODUCTION_CONTAINER_IMAGE to test the production Caddy image.");
  const { containerId, baseURL } = await startContainer(containerImage!);
  try {
    await expect
      .poll(
        async () => {
          try {
            return (await fetch(baseURL, { signal: AbortSignal.timeout(1_000) })).status;
          } catch {
            return 0;
          }
        },
        { timeout: 30_000, intervals: [250, 500, 1_000] },
      )
      .toBe(200);

    const htmlResponse = await page.goto(`${baseURL}/`);
    expect(htmlResponse?.status()).toBe(200);
    await expectCompressed(`${baseURL}/`, /^text\/html(?:;|$)/i, "gzip");
    await expect(page).toHaveTitle(/MCL\b/i);
    const securityHeaders = await htmlResponse!.allHeaders();
    expect(securityHeaders["content-security-policy"]).toBe("frame-ancestors 'none'");
    expect(securityHeaders["cross-origin-resource-policy"]).toBe("same-origin");
    expect(securityHeaders["referrer-policy"]).toBe("no-referrer");
    expect(securityHeaders["x-content-type-options"]).toBe("nosniff");
    expect(securityHeaders["permissions-policy"]).toBe("camera=(), microphone=(), geolocation=()");

    const scriptResponses: import("@playwright/test").Response[] = [];
    page.on("response", (response) => {
      const pathname = new URL(response.url()).pathname;
      if (pathname.startsWith("/_astro/") && pathname.endsWith(".js")) scriptResponses.push(response);
    });
    await page.goto(`${baseURL}/playground/`);
    await expect(page.getByRole("button", { name: "実行" })).toBeVisible();
    const scriptResponse = scriptResponses.find((response) =>
      /^(?:application|text)\/javascript(?:;|$)/i.test(response.headers()["content-type"] ?? ""),
    );
    expect(
      scriptResponse,
      "the production page should load a fingerprinted JavaScript bundle",
    ).toBeDefined();
    expect((await scriptResponse!.allHeaders())["cache-control"]).toMatch(/max-age=31536000.*immutable/i);
    await expectCompressed(scriptResponse!.url(), /^(?:application|text)\/javascript(?:;|$)/i, "br, gzip");

    const stylesheetURL = await page
      .locator('link[rel="stylesheet"]')
      .first()
      .evaluate((link) => (link as HTMLLinkElement).href);
    await expectCompressed(stylesheetURL, /^text\/css(?:;|$)/i, "br, gzip");

    const wasmResponse = page.waitForResponse((response) =>
      wasmAssetPath.test(new URL(response.url()).pathname),
    );
    await page.getByRole("button", { name: "実行" }).click();
    const browserWasmResponse = await wasmResponse;
    expect(browserWasmResponse.status()).toBe(200);
    expect(browserWasmResponse.headers()["content-type"]).toMatch(/^application\/wasm(?:;|$)/i);
    expect(browserWasmResponse.headers().vary).toMatch(/(?:^|,)\s*accept-encoding\s*(?:,|$)/i);
    expect(browserWasmResponse.headers()["cache-control"]).toMatch(/max-age=31536000.*immutable/i);

    const identity = await getEncodedAsset(browserWasmResponse.url(), "identity");
    expect(identity.status).toBe(200);
    expect(identity.headers["content-encoding"]).toBeUndefined();
    expect(identity.headers["content-type"]).toMatch(/^application\/wasm(?:;|$)/i);
    expect(identity.headers.vary).toMatch(/(?:^|,)\s*accept-encoding\s*(?:,|$)/i);
    expect(identity.headers["cache-control"]).toMatch(/max-age=31536000.*immutable/i);
    expect(identity.body.subarray(0, 4)).toEqual(Buffer.from([0x00, 0x61, 0x73, 0x6d]));

    for (const [acceptEncoding, expectedEncoding] of [
      ["br, gzip", "br"],
      ["gzip", "gzip"],
      ["br;q=0, gzip", "gzip"],
    ]) {
      const response = await getEncodedAsset(browserWasmResponse.url(), acceptEncoding);
      expect(response.status).toBe(200);
      expect(response.headers["content-encoding"]).toBe(expectedEncoding);
      expect(response.headers["content-type"]).toMatch(/^application\/wasm(?:;|$)/i);
      expect(response.headers.vary).toMatch(/(?:^|,)\s*accept-encoding\s*(?:,|$)/i);
      expect(response.headers["cache-control"]).toMatch(/max-age=31536000.*immutable/i);
      expect(decodeWasm(response.body, response.headers["content-encoding"] as string)).toEqual(identity.body);
    }

    const output = page.getByLabel("レンダリング結果");
    await expect(output).toContainText('kind: "ConfigMap"');
    await expect(output).toContainText('name: "catalog"');
  } finally {
    await execFileAsync("docker", ["rm", "--force", containerId]);
  }
});
