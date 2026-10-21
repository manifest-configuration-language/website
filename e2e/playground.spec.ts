import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";

const projectDirectory = fileURLToPath(new URL("./fixtures/project", import.meta.url));

function editor(page: import("@playwright/test").Page) {
  return page.locator('[aria-label="MCLソース"]');
}

test.beforeEach(async ({ page }) => {
  await page.goto("/playground/");
});

test("renders the starter source as a Kubernetes resource", async ({ page }) => {
  await page.getByRole("button", { name: "実行" }).click();

  const output = page.getByLabel("レンダリング結果");
  await expect(output).toContainText('kind: "ConfigMap"');
  await expect(output).toContainText('name: "catalog"');
});

test("formats source in the editor", async ({ page }) => {
  await editor(page).fill('let value =\n    key: "value"\nemit value\n');
  await page.getByRole("button", { name: "整形" }).click();

  await expect
    .poll(() =>
      editor(page).evaluate((element) =>
        [...element.querySelectorAll(".cm-line")].map((line) => line.textContent).join("\n"),
      ),
    )
    .toBe('let value =\n  key: "value"\nemit value\n');
});

test("loads a project folder and resolves its relative MCL import", async ({ page }) => {
  await page.getByLabel("MCLプロジェクトフォルダー").setInputFiles(projectDirectory);
  await expect(editor(page)).toContainText('import "modules/resource.mcl"');
  await page.getByRole("button", { name: "実行" }).click();

  const output = page.getByLabel("レンダリング結果");
  await expect(output).toContainText('name: "imported"');
  await expect(output).toContainText('origin: "project folder"');
});

test("shows a source diagnostic for an invalid program", async ({ page }) => {
  await editor(page).fill("emit missingValue\n");
  await page.getByRole("button", { name: "実行" }).click();

  await expect(page.getByRole("button", { name: /MCL-UNDEFINED.*missingValue/ })).toBeVisible();
  await expect(page.getByLabel("レンダリング結果")).toHaveCount(0);
});

test("cancels a run during worker startup and allows the next run", async ({ page }) => {
  let releaseFirstRequest: (() => void) | undefined;
  let wasmRequests = 0;
  await page.route("**/mcl.wasm.gz", async (route) => {
    wasmRequests += 1;
    if (wasmRequests === 1) {
      await new Promise<void>((resolve) => {
        releaseFirstRequest = resolve;
      });
    }
    await route.continue();
  });

  await page.getByRole("button", { name: "実行" }).click();
  await expect.poll(() => wasmRequests).toBe(1);
  await page.getByRole("button", { name: "中断" }).click();
  releaseFirstRequest?.();
  await expect(page.getByRole("button", { name: "実行" })).toBeVisible();
  await expect(page.getByLabel("レンダリング結果")).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);

  await page.getByRole("button", { name: "実行" }).click();
  await expect(page.getByLabel("レンダリング結果")).toContainText('kind: "ConfigMap"');
  expect(wasmRequests).toBe(2);
});
