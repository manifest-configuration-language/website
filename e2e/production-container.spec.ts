import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { gunzipSync } from "node:zlib";
import { expect, test } from "@playwright/test";

const execFileAsync = promisify(execFile);
const containerImage = process.env.PRODUCTION_CONTAINER_IMAGE;
const wasmAssetPath = /\/_astro\/mcl\.wasm-[A-Za-z0-9_-]{8,}\.wasm$/;

async function startContainer(image: string) {
  const { stdout } = await execFileAsync("docker", [
    "run",
    "--detach",
    "--read-only",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges",
    "--user",
    "101:101",
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

function expectGzipResponse(headers: Record<string, string>, contentType: RegExp) {
  expect(headers["content-type"]).toMatch(contentType);
  expect(headers["content-encoding"]).toBe("gzip");
  expect(headers.vary).toMatch(/(?:^|,)\s*accept-encoding\s*(?:,|$)/i);
}

function wasmPayload(body: Buffer) {
  if (body.subarray(0, 2).equals(Buffer.from([0x1f, 0x8b]))) return gunzipSync(body);
  return body;
}

test("serves and runs the production site in a hardened Nginx container", async ({
  page,
  request,
}) => {
  test.skip(!containerImage, "Set PRODUCTION_CONTAINER_IMAGE to test the production Nginx image.");

  const { containerId, baseURL } = await startContainer(containerImage!);
  try {
    await expect
      .poll(
        async () => {
          try {
            return (await request.get(baseURL, { timeout: 1_000 })).status();
          } catch {
            return 0;
          }
        },
        { timeout: 30_000, intervals: [250, 500, 1_000] },
      )
      .toBe(200);

    const htmlResponse = await page.goto(`${baseURL}/`);
    expect(htmlResponse?.status()).toBe(200);
    expectGzipResponse(await htmlResponse!.allHeaders(), /^text\/html(?:;|$)/i);
    await expect(page).toHaveTitle(/MCL\b/i);

    const securityHeaders = await htmlResponse!.allHeaders();
    const csp = securityHeaders["content-security-policy"];
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("form-action 'self'");
    expect(securityHeaders["cross-origin-resource-policy"]).toBe("same-origin");
    expect(securityHeaders["referrer-policy"]).toBe("no-referrer");
    expect(securityHeaders["x-content-type-options"]).toBe("nosniff");
    expect(securityHeaders["permissions-policy"]).toBe("camera=(), microphone=(), geolocation=()");

    const scriptResponses: import("@playwright/test").Response[] = [];
    page.on("response", (response) => {
      const pathname = new URL(response.url()).pathname;
      if (pathname.startsWith("/_astro/") && pathname.endsWith(".js"))
        scriptResponses.push(response);
    });
    await page.goto(`${baseURL}/playground/`);
    await expect(page.getByRole("button", { name: "実行" })).toBeVisible();

    const scriptResponse = scriptResponses.find((response) =>
      /^application\/javascript(?:;|$)/i.test(response.headers()["content-type"] ?? ""),
    );
    expect(
      scriptResponse,
      "the production page should load a fingerprinted JavaScript bundle",
    ).toBeDefined();
    const scriptHeaders = await scriptResponse!.allHeaders();
    expectGzipResponse(scriptHeaders, /^application\/javascript(?:;|$)/i);
    expect(scriptHeaders["cache-control"]).toMatch(/max-age=31536000.*immutable/i);
    expect((await scriptResponse!.body()).byteLength).toBeGreaterThan(0);

    const wasmResponse = page.waitForResponse((response) =>
      wasmAssetPath.test(new URL(response.url()).pathname),
    );
    await page.getByRole("button", { name: "実行" }).click();
    const browserWasmResponse = await wasmResponse;
    expect(browserWasmResponse.status()).toBe(200);
    const wasmHeaders = browserWasmResponse.headers();
    expectGzipResponse(wasmHeaders, /^application\/wasm(?:;|$)/i);
    expect(wasmHeaders["cache-control"]).toMatch(/max-age=31536000.*immutable/i);
    const wasmAsset = await request.get(browserWasmResponse.url());
    expect(wasmAsset.status()).toBe(200);
    expectGzipResponse(wasmAsset.headers(), /^application\/wasm(?:;|$)/i);
    expect(wasmPayload(await wasmAsset.body()).subarray(0, 4)).toEqual(
      Buffer.from([0x00, 0x61, 0x73, 0x6d]),
    );
    const identityWasmAsset = await request.get(browserWasmResponse.url(), {
      headers: { "accept-encoding": "identity" },
    });
    expect(identityWasmAsset.status()).toBe(200);
    const identityHeaders = identityWasmAsset.headers();
    expect(identityHeaders["content-type"]).toMatch(/^application\/wasm(?:;|$)/i);
    expect(identityHeaders["content-encoding"]).toBeUndefined();
    expect(identityHeaders.vary).toMatch(/(?:^|,)\s*accept-encoding\s*(?:,|$)/i);
    expect((await identityWasmAsset.body()).subarray(0, 4)).toEqual(
      Buffer.from([0x00, 0x61, 0x73, 0x6d]),
    );

    const output = page.getByLabel("レンダリング結果");
    await expect(output).toContainText('kind: "ConfigMap"');
    await expect(output).toContainText('name: "catalog"');
  } finally {
    await execFileAsync("docker", ["rm", "--force", containerId]);
  }
});
