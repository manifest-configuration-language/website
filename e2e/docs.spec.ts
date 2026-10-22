import { expect, test } from "@playwright/test";

function parseCsp(policy: string): Map<string, string[]> {
  const entries = policy
    .split(";")
    .map((directive) => directive.trim())
    .filter(Boolean)
    .map((directive) => {
      const [name, ...sources] = directive.split(/\s+/);
      return [name, sources] as [string, string[]];
    });
  return new Map(entries);
}

async function astroContentSecurityPolicy(page: import("@playwright/test").Page) {
  const metas = page.locator('meta[http-equiv="content-security-policy"]');
  await expect(metas).toHaveCount(1);
  const content = await metas.getAttribute("content");
  expect(content).toBeTruthy();
  return parseCsp(content ?? "");
}

test("Astro CSP keeps its restrictive directives and source allowlist", async ({ page }) => {
  await page.goto("/");
  const directives = await astroContentSecurityPolicy(page);
  expect([...directives.keys()].sort()).toEqual(
    [
      "base-uri",
      "connect-src",
      "default-src",
      "font-src",
      "form-action",
      "img-src",
      "object-src",
      "script-src",
      "style-src",
      "style-src-attr",
      "style-src-elem",
      "worker-src",
    ].sort(),
  );
  expect(directives.get("default-src")).toEqual(["'self'"]);
  expect(directives.get("form-action")).toEqual(["'self'"]);
  expect(directives.get("object-src")).toEqual(["'none'"]);
  expect(directives.get("base-uri")).toEqual(["'self'"]);
  expect(directives.get("worker-src")).toEqual(["'self'"]);
  expect(directives.get("connect-src")).toEqual(["'self'"]);
  expect(directives.get("img-src")).toEqual(["'self'", "data:"]);
  expect(directives.get("font-src")).toEqual(["'self'", "data:"]);
  expect(directives.get("style-src")).toEqual(["'self'"]);

  const scriptSources = directives.get("script-src") ?? [];
  expect(scriptSources).toContain("'self'");
  expect(scriptSources).toContain("'wasm-unsafe-eval'");
  expect(scriptSources).toContainEqual(expect.stringMatching(/^'sha256-[A-Za-z0-9+/]+={0,2}'$/));
  expect(
    scriptSources.filter(
      (source) =>
        source !== "'self'" &&
        source !== "'wasm-unsafe-eval'" &&
        !/^'sha256-[A-Za-z0-9+/]+={0,2}'$/.test(source),
    ),
  ).toEqual([]);
  const styleElementSources = directives.get("style-src-elem") ?? [];
  expect(styleElementSources).toContain("'self'");
  expect(styleElementSources).toContain("'unsafe-inline'");
  expect(directives.get("style-src-attr")).toEqual(["'unsafe-inline'"]);
  expect(
    await page.evaluate(() => {
      const policy = document.querySelector('meta[http-equiv="content-security-policy"]');
      const firstResource = document.head.querySelector('script, style, link[rel="stylesheet"]');
      return Boolean(
        policy &&
        firstResource &&
        policy.compareDocumentPosition(firstResource) & Node.DOCUMENT_POSITION_FOLLOWING,
      );
    }),
  ).toBe(true);
});

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
    if (/mcl-[A-Za-z0-9_-]{8,}\.wasm|playground\.worker-/.test(request.url()))
      runtimeRequests.push(request.url());
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
  const response = await page.goto("/");
  expect(response?.headers()["content-security-policy"]).toBeUndefined();
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
