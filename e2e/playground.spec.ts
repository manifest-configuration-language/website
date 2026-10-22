import { expect, test } from "@playwright/test";

test("renders MCL in the production Playground", async ({ page }) => {
  const cspViolations: string[] = [];
  page.on("console", (message) => {
    if (/violates the following Content Security Policy directive/i.test(message.text())) {
      cspViolations.push(message.text());
    }
  });

  const response = await page.goto("/playground/");
  expect(response?.status()).toBe(200);

  const headers = response!.headers();
  expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(headers["cross-origin-resource-policy"]).toBe("same-origin");
  expect(headers["referrer-policy"]).toBe("no-referrer");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["permissions-policy"]).toBe("camera=(), microphone=(), geolocation=()");

  const metaCsp = await page
    .locator('meta[http-equiv="Content-Security-Policy" i]')
    .getAttribute("content");
  expect(metaCsp).toContain("default-src 'self'");
  expect(metaCsp).toContain("form-action 'self'");

  await expect(page.getByRole("button", { name: "実行" })).toBeVisible();

  const wasmResponse = page.waitForResponse(
    (response) => response.url().includes(".wasm") && response.status() === 200,
  );
  await page.getByRole("button", { name: "実行" }).click();
  await wasmResponse;

  await expect(page.getByLabel("レンダリング結果")).toContainText('kind: "ConfigMap"');
  await expect(page.getByLabel("レンダリング結果")).toContainText('name: "catalog"');
  expect(cspViolations).toEqual([]);
});
