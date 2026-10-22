import { expect, test } from "@playwright/test";

test("renders the starter source using the compressed WASM served by Nginx", async ({ page }) => {
  test.skip(!process.env.PLAYWRIGHT_BASE_URL, "Requires the production Nginx container.");

  const wasmResponse = page
    .context()
    .waitForEvent("response", (response) =>
      /\/mcl\.wasm-[A-Za-z0-9_-]{8,}\.wasm$/.test(new URL(response.url()).pathname),
    );

  await page.goto("/playground/");
  await page.getByRole("button", { name: "実行" }).click();

  const response = await wasmResponse;
  expect(response.status()).toBe(200);
  const headers = response.headers();
  expect(headers["content-type"]).toMatch(/^application\/wasm(?:;|$)/i);
  expect(headers["content-encoding"]).toBe("gzip");
  expect(headers["cache-control"]).toContain("immutable");

  const output = page.getByLabel("レンダリング結果");
  await expect(output).toContainText('kind: "ConfigMap"');
  await expect(output).toContainText('name: "catalog"');
});
