import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { addWasmAssetHeaders, closeWasmAssetServer } from "./previewRoutes";

const securityHeaders = readFileSync(
  new URL("../.build/security-headers.conf", import.meta.url),
  "utf8",
);
const contentSecurityPolicy = securityHeaders.match(
  /^add_header Content-Security-Policy "(.+)" always;$/m,
)?.[1];

if (!contentSecurityPolicy)
  throw new Error("The generated Content Security Policy is unavailable.");

test.afterAll(async () => closeWasmAssetServer());

test("home page highlights MCL code and switches themes", async ({ page }) => {
  await page.goto("/");

  await expect(page.locator("main h1").first()).toHaveText("MCL");
  const keyword = page
    .locator('pre[data-language="mcl"] .ec-line')
    .first()
    .locator(".code span")
    .first();
  await expect(keyword).toHaveText("let");
  await expect(keyword).toHaveAttribute("style", /--0:/);

  const theme = page.locator("starlight-theme-select select").first();
  await theme.selectOption("light");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await theme.selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("reference pages do not load the Playground runtime", async ({ page }) => {
  const runtimeRequests: string[] = [];
  page.on("request", (request) => {
    if (/mcl\.wasm-|playground\.worker-/.test(request.url())) runtimeRequests.push(request.url());
  });

  await page.goto("/reference/");

  await expect(page.locator(".cm-editor")).toHaveCount(0);
  expect(runtimeRequests).toEqual([]);
});

test("search opens results and navigates to a language reference", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "検索" }).click();

  const dialog = page.getByRole("dialog", { name: "検索" });
  const search = dialog.locator("input");
  await expect(search).toBeVisible();
  await search.fill("DeploymentKind");
  const result = dialog.getByRole("link", { name: /型/ }).first();
  await expect(result).toBeVisible();
  await result.click();

  await expect(page).toHaveURL(/\/reference\/types\/?/);
  await expect(page.locator("main h1").first()).toHaveText("型");
});

test("documentation and Playground work under the generated CSP", async ({ page }) => {
  await page.addInitScript(() => {
    const state = window as unknown as Window & { __cspViolations: string[] };
    state.__cspViolations = [];
    document.addEventListener("securitypolicyviolation", (event) => {
      state.__cspViolations.push(`${event.violatedDirective}: ${event.blockedURI}`);
    });
  });
  await page.route("**/*", async (route) => {
    if (!route.request().isNavigationRequest()) return route.continue();
    const response = await route.fetch();
    return route.fulfill({
      response,
      headers: { ...response.headers(), "content-security-policy": contentSecurityPolicy },
    });
  });
  await addWasmAssetHeaders(page);

  const response = await page.goto("/");
  expect(response?.headers()["content-security-policy"]).toBe(contentSecurityPolicy);
  await expect(page.locator('pre[data-language="mcl"]')).toBeVisible();
  await page.locator("starlight-theme-select select").first().selectOption("light");
  await page.getByRole("button", { name: "検索" }).click();
  const dialog = page.getByRole("dialog", { name: "検索" });
  await dialog.locator("input").fill("型");
  await expect(dialog.getByRole("link", { name: /型/ }).first()).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as Window & { __cspViolations: string[] }).__cspViolations,
      ),
    )
    .toEqual([]);

  await page.goto("/playground/");
  await page.getByRole("button", { name: "実行" }).click();
  await expect(page.getByLabel("レンダリング結果")).toContainText('kind: "ConfigMap"', {
    timeout: 15_000,
  });
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as Window & { __cspViolations: string[] }).__cspViolations,
      ),
    )
    .toEqual([]);
});

test("published documentation includes the playground capability contract", async ({ page }) => {
  await page.goto("/playground/capabilities/");

  await expect(page.locator("main h1").first()).toHaveText("プレイグラウンドの対応機能");
  await expect(page.getByRole("table").nth(1)).toContainText("相対import");
  await expect(page.getByRole("table").nth(1)).toContainText("HTTPSやOCIからの取得");
  await expect(page.getByRole("main")).toContainText("32 MiB");
  await expect(page.getByRole("main")).toContainText("4秒");
});

test("reference pages publish the documented local adapter and schema behavior", async ({
  page,
}) => {
  await page.goto("/reference/functions/");
  await expect(page.locator("main h1").first()).toHaveText("標準関数");
  await expect(page.getByRole("main")).toContainText("std:kustomize");
  await expect(page.getByRole("main")).toContainText(
    "プロジェクトルート外のローカルファイル読み込み",
  );

  await page.goto("/reference/types/");
  await expect(page.locator("main h1").first()).toHaveText("型");
  await expect(page.getByRole("main")).toContainText("参照先はプロジェクトルート内に限定します");
});

test("playground documentation links to the published capability page", async ({ page }) => {
  await page.goto("/playground/");
  await page
    .getByRole("region", { name: "MCLプレイグラウンド" })
    .getByRole("link", { name: "対応機能" })
    .click();
  await expect(page).toHaveURL(/\/playground\/capabilities\/?$/);
  await expect(page.locator("main h1").first()).toHaveText("プレイグラウンドの対応機能");
});
