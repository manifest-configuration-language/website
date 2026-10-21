import { expect, test } from "@playwright/test";

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
