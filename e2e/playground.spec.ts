import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";

const projectDirectory = fileURLToPath(new URL("./fixtures/project", import.meta.url));

function editor(page: import("@playwright/test").Page) {
  return page.locator('[aria-label="MCLソース"]');
}

async function expectRendered(page: import("@playwright/test").Page, ...fragments: string[]) {
  await page.waitForFunction(
    () =>
      document.querySelector('[aria-label="レンダリング結果"]') ||
      document.querySelector('.playground [role="alert"]'),
    null,
    { timeout: 8_000 },
  );
  const output = page.getByLabel("レンダリング結果");
  if ((await output.count()) === 0) {
    const alert = (await page.getByRole("alert").allTextContents()).join(" ");
    throw new Error(`Playground did not render output. UI alert: ${alert || "none"}`);
  }
  for (const fragment of fragments) await expect(output).toContainText(fragment);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/playground/");
});

test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status === testInfo.expectedStatus) return;
  const state = await page
    .locator(".playground")
    .innerText()
    .catch(() => "Playground content is unavailable.");
  console.error(
    `Playground state after ${testInfo.title}: ${state.replace(/\s+/g, " ").slice(0, 1_000)}`,
  );
});

test("renders the starter source as a Kubernetes resource", async ({ page }) => {
  await page.getByRole("button", { name: "実行" }).click();

  await expectRendered(page, 'kind: "ConfigMap"', 'name: "catalog"');
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

  await expectRendered(page, 'name: "imported"', 'origin: "project folder"');
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
  await expectRendered(page, 'kind: "ConfigMap"');
  expect(wasmRequests).toBe(2);
});
