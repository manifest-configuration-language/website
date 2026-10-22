import { expect, test } from "@playwright/test";
import { Buffer } from "node:buffer";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const projectDirectory = fileURLToPath(new URL("./fixtures/project", import.meta.url));
const helmProjectDirectory = fileURLToPath(new URL("./fixtures/helm-project", import.meta.url));
const kustomizeProjectDirectory = fileURLToPath(
  new URL("./fixtures/kustomize-project", import.meta.url),
);
const crossBrowserPlaygroundScenarios = new Set([
  "formats source in the editor",
  "loads a project folder and resolves its relative MCL import",
  "rejects duplicate project paths and keeps the loaded project",
  "renders a local Helm Chart from the selected project folder",
  "builds a local Kustomize overlay from the selected project folder",
  "shows the project loading state while files are being read",
  "shows a source diagnostic for an invalid program",
  "rejects a project import that escapes the project root",
  "rejects a project file larger than the per-file limit",
  "rejects a project larger than the total size limit and keeps the loaded project",
  "cancels a run during worker startup and allows the next run",
  "terminates a timed-out worker and allows another run",
  "denies uncached external manifest fetches",
  "editing source cancels an active run and discards its result",
  "retries after the WebAssembly worker reports an initialization failure",
]);

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

test.beforeEach(async ({ page, browserName }, testInfo) => {
  test.skip(
    browserName !== "chromium" && !crossBrowserPlaygroundScenarios.has(testInfo.title),
    "Detailed Playground scenarios run in Chromium; Docs CSP and Browser SDK smoke tests cover all three browsers.",
  );
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
  await expect
    .poll(() =>
      editor(page).evaluate((element) =>
        [...element.querySelectorAll(".cm-line")].map((line) => line.textContent).join("\n"),
      ),
    )
    .toContain('import "modules/resource.mcl"');
  await page.getByRole("button", { name: "実行" }).click();

  await expectRendered(page, 'name: "imported"', 'origin: "project folder"');
});

test("shows the project loading state while files are being read", async ({ page }) => {
  let markReadStarted!: () => void;
  const readStarted = new Promise<void>((resolve) => {
    markReadStarted = resolve;
  });
  let releaseRead!: () => void;
  const readGate = new Promise<void>((resolve) => {
    releaseRead = resolve;
  });
  await page.exposeFunction("__waitForProjectRead", async () => {
    markReadStarted();
    await readGate;
  });
  await page.evaluate(() => {
    const readText = Blob.prototype.text;
    Blob.prototype.text = async function () {
      await (
        window as unknown as Window & { __waitForProjectRead: () => Promise<void> }
      ).__waitForProjectRead();
      return readText.call(this);
    };
  });

  await page.getByLabel("MCLプロジェクトフォルダー").setInputFiles(projectDirectory);
  await readStarted;

  await expect(page.getByRole("status")).toHaveText("読み込み中");
  await expect(page.locator(".playground")).toHaveAttribute("aria-busy", "true");
  await expect(page.getByRole("button", { name: "実行" })).toBeDisabled();

  releaseRead();
  await expect(page.getByRole("status")).toHaveCount(0);
  await expect(page.locator(".playground")).toHaveAttribute("aria-busy", "false");
  await expect(editor(page)).toContainText('import "modules/resource.mcl"');
});

test("rejects duplicate project paths and keeps the loaded project", async ({ page }) => {
  await page.getByLabel("MCLプロジェクトフォルダー").setInputFiles(projectDirectory);
  await page.getByRole("button", { name: "実行" }).click();
  await expectRendered(page, 'name: "imported"', 'origin: "project folder"');

  await page.getByLabel("MCLプロジェクトフォルダー").evaluate((element: HTMLInputElement) => {
    const files = new DataTransfer();
    for (const [index, source] of ['emit "duplicate-one"\n', 'emit "duplicate-two"\n'].entries()) {
      const file = new File([source], `duplicate-${index}.mcl`, { type: "text/plain" });
      Object.defineProperty(file, "webkitRelativePath", { value: "project/main.mcl" });
      files.items.add(file);
    }
    element.files = files.files;
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });

  await expect(page.getByRole("alert")).toContainText("Duplicate project path: main.mcl");
  await expect(editor(page)).toContainText('import "modules/resource.mcl"');
  await page.getByRole("button", { name: "実行" }).click();
  await expectRendered(page, 'name: "imported"', 'origin: "project folder"');
});

test("renders a local Helm Chart from the selected project folder", async ({ page }) => {
  await page.getByLabel("MCLプロジェクトフォルダー").setInputFiles(helmProjectDirectory);
  await expect
    .poll(() =>
      editor(page).evaluate((element) =>
        [...element.querySelectorAll(".cm-line")].map((line) => line.textContent).join("\n"),
      ),
    )
    .toContain('helm.render("charts/api"');
  await page.getByRole("button", { name: "実行" }).click();

  await expectRendered(
    page,
    'kind: "Deployment"',
    'name: "website"',
    "replicas: 2",
    'image: "example.test.walnuts.dev/api:v1"',
  );
});

test("builds a local Kustomize overlay from the selected project folder", async ({ page }) => {
  await page.getByLabel("MCLプロジェクトフォルダー").setInputFiles(kustomizeProjectDirectory);
  await expect
    .poll(() =>
      editor(page).evaluate((element) =>
        [...element.querySelectorAll(".cm-line")].map((line) => line.textContent).join("\n"),
      ),
    )
    .toContain('directory = "k8s/overlay"');
  await page.getByRole("button", { name: "実行" }).click();

  await expectRendered(
    page,
    'kind: "ConfigMap"',
    'name: "web-settings"',
    'app.kubernetes.io/name: "web"',
    'source: "local-kustomize"',
  );
});

test("shows a source diagnostic for an invalid program", async ({ page }) => {
  await editor(page).fill("emit missingValue\n");
  await page.getByRole("button", { name: "実行" }).click();

  const diagnostic = page.getByRole("button", { name: /MCL-UNDEFINED.*missingValue/ });
  await expect(diagnostic).toBeVisible();
  await diagnostic.click();
  await expect
    .poll(() =>
      editor(page).evaluate((element) => {
        const selection = window.getSelection();
        if (!selection?.anchorNode || !element.contains(selection.anchorNode)) return null;
        const range = document.createRange();
        range.selectNodeContents(element);
        range.setEnd(selection.anchorNode, selection.anchorOffset);
        return range.toString().length;
      }),
    )
    .toBe(5);
  await expect(page.getByLabel("レンダリング結果")).toHaveCount(0);

  await editor(page).fill('emit "recovered"\n');
  await page.getByRole("button", { name: "実行" }).click();
  await expectRendered(page, '"recovered"');
});

test("rejects a project import that escapes the project root", async ({ page }) => {
  await editor(page).fill('import "../outside.mcl" as outside\nemit outside.value\n');
  await page.getByRole("button", { name: "実行" }).click();

  await expect(page.getByRole("button", { name: /MCL-.*outside|outside.*project/i })).toBeVisible();
  await expect(page.getByLabel("レンダリング結果")).toHaveCount(0);
});

test("rejects a project file larger than the per-file limit", async ({ page }) => {
  const directory = mkdtempSync(join(tmpdir(), "mcl-e2e-size-limit-"));
  writeFileSync(join(directory, "main.mcl"), 'emit "ok"\n');
  writeFileSync(join(directory, "oversized.bin"), Buffer.alloc(16 * 1024 * 1024 + 1));
  try {
    await page.getByLabel("MCLプロジェクトフォルダー").setInputFiles(directory);
    await expect(page.getByRole("alert")).toContainText(
      "oversized.bin exceeds the 16 MiB per-file limit.",
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }

  await expect(editor(page)).toContainText('let appName = "catalog"');
});

test("rejects a project larger than the total size limit and keeps the loaded project", async ({
  page,
}) => {
  await page.getByLabel("MCLプロジェクトフォルダー").setInputFiles(projectDirectory);
  await page.getByRole("button", { name: "実行" }).click();
  await expectRendered(page, 'name: "imported"', 'origin: "project folder"');

  const directory = mkdtempSync(join(tmpdir(), "mcl-e2e-project-size-limit-"));
  writeFileSync(join(directory, "main.mcl"), 'emit "oversized project"\n');
  const file = Buffer.alloc(16 * 1024 * 1024);
  writeFileSync(join(directory, "first.bin"), file);
  writeFileSync(join(directory, "second.bin"), file);
  try {
    await page.getByLabel("MCLプロジェクトフォルダー").setInputFiles(directory);
    await expect(page.getByRole("alert")).toContainText(
      "The project exceeds the 32 MiB total limit.",
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }

  await expect(editor(page)).toContainText('import "modules/resource.mcl"');
  await page.getByRole("button", { name: "実行" }).click();
  await expectRendered(page, 'name: "imported"', 'origin: "project folder"');
});

test("rejects a project larger than the file count limit and keeps the loaded project", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium");

  await page.getByLabel("MCLプロジェクトフォルダー").setInputFiles(projectDirectory);
  await page.getByRole("button", { name: "実行" }).click();
  await expectRendered(page, 'name: "imported"', 'origin: "project folder"');

  const directory = mkdtempSync(join(tmpdir(), "mcl-e2e-project-file-count-limit-"));
  writeFileSync(join(directory, "main.mcl"), 'emit "oversized project"\n');
  for (let index = 0; index < 4096; index += 1) {
    writeFileSync(join(directory, `file-${index}.bin`), Buffer.alloc(0));
  }
  try {
    await page.getByLabel("MCLプロジェクトフォルダー").setInputFiles(directory);
    await expect(page.getByRole("alert")).toContainText(/at most [\d,]+ files\./);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }

  await expect(editor(page)).toContainText('import "modules/resource.mcl"');
  await page.getByRole("button", { name: "実行" }).click();
  await expectRendered(page, 'name: "imported"', 'origin: "project folder"');
});

test("denies uncached external manifest fetches", async ({ page }) => {
  const externalRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).hostname === "example.invalid") externalRequests.push(request.url());
  });
  await editor(page).fill(
    'import "std:manifest" as manifest\nlet resources = manifest.load("https://example.invalid/manifest.yaml")\nemit resources\n',
  );
  await page.getByRole("button", { name: "実行" }).click();

  const networkError = page.getByRole("alert");
  await expect(networkError).toContainText("MCL-WASM-NETWORK");
  await expect(networkError).toContainText(
    "remote dependency access is unavailable in this browser runtime; include dependencies in the project files",
  );
  expect(externalRequests).toEqual([]);
});

test("cancels a run during worker startup and allows the next run", async ({ page }) => {
  let releaseFirstRequest: (() => void) | undefined;
  let wasmRequests = 0;
  await page.route("**/mcl-*.wasm", async (route) => {
    wasmRequests += 1;
    if (wasmRequests === 1) {
      await new Promise<void>((resolve) => {
        releaseFirstRequest = resolve;
      });
    }
    await route.fallback();
  });
  await page.evaluate(() => {
    const state = { terminated: 0 };
    Object.defineProperty(window, "__playgroundWorkerState", { value: state });
    const originalTerminate = Worker.prototype.terminate;
    Worker.prototype.terminate = function () {
      state.terminated += 1;
      return originalTerminate.call(this);
    };
  });

  await page.getByRole("button", { name: "実行" }).click();
  await expect.poll(() => wasmRequests).toBe(1);
  await page.getByRole("button", { name: "中断" }).click();
  releaseFirstRequest?.();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as Window & { __playgroundWorkerState?: { terminated: number } })
            .__playgroundWorkerState?.terminated ?? 0,
      ),
    )
    .toBe(1);
  await expect(page.getByRole("button", { name: "実行" })).toBeVisible();
  await expect(page.getByLabel("レンダリング結果")).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);

  await page.getByRole("button", { name: "実行" }).click();
  await expectRendered(page, 'kind: "ConfigMap"');
  expect(wasmRequests).toBe(2);
});

test("retries after the WebAssembly worker reports an initialization failure", async ({ page }) => {
  let wasmRequests = 0;
  await page.route("**/mcl-*.wasm", async (route) => {
    wasmRequests += 1;
    if (wasmRequests === 1) {
      await route.fulfill({ status: 503, body: "Unavailable" });
      return;
    }
    await route.fallback();
  });
  await page.evaluate(() => {
    const state = { terminated: 0 };
    Object.defineProperty(window, "__playgroundWorkerState", { value: state });
    const originalTerminate = Worker.prototype.terminate;
    Worker.prototype.terminate = function () {
      state.terminated += 1;
      return originalTerminate.call(this);
    };
  });

  await page.getByRole("button", { name: "実行" }).click();
  await expect.poll(() => wasmRequests).toBe(1);
  await expect(page.getByRole("alert")).toContainText(
    "Unable to download the MCL WebAssembly runtime.",
  );
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as Window & { __playgroundWorkerState?: { terminated: number } })
            .__playgroundWorkerState?.terminated ?? 0,
      ),
    )
    .toBe(1);

  await page.getByRole("button", { name: "実行" }).click();
  await expectRendered(page, 'kind: "ConfigMap"');
  expect(wasmRequests).toBe(2);
});

test("editing source cancels an active run and discards its result", async ({ page }) => {
  let releaseFirstRequest: (() => void) | undefined;
  let wasmRequests = 0;
  await page.route("**/mcl-*.wasm", async (route) => {
    wasmRequests += 1;
    if (wasmRequests === 1) {
      await new Promise<void>((resolve) => {
        releaseFirstRequest = resolve;
      });
      await route.fallback().catch(() => {});
      return;
    }
    await route.fallback();
  });
  await page.evaluate(() => {
    const state = { terminated: 0 };
    Object.defineProperty(window, "__playgroundWorkerState", { value: state });
    const originalTerminate = Worker.prototype.terminate;
    Worker.prototype.terminate = function () {
      state.terminated += 1;
      return originalTerminate.call(this);
    };
  });

  await page.getByRole("button", { name: "実行" }).click();
  await expect.poll(() => wasmRequests).toBe(1);
  await editor(page).fill('emit "new source"\n');
  releaseFirstRequest?.();

  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as Window & { __playgroundWorkerState?: { terminated: number } })
            .__playgroundWorkerState?.terminated ?? 0,
      ),
    )
    .toBe(1);
  await expect(page.getByLabel("レンダリング結果")).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);

  await page.getByRole("button", { name: "実行" }).click();
  await expectRendered(page, '"new source"');
  expect(wasmRequests).toBe(2);
});

test("terminates a timed-out worker and allows another run", async ({ page }) => {
  await page.evaluate(() => {
    const state = { ignoreNextLint: true, terminated: 0 };
    Object.defineProperty(window, "__playgroundWorkerState", { value: state });
    const originalPostMessage = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message, transfer) {
      if (state.ignoreNextLint && (message as { operation?: string }).operation === "lint") {
        state.ignoreNextLint = false;
        return;
      }
      return Reflect.apply(originalPostMessage, this, [message, transfer]);
    };
    const originalTerminate = Worker.prototype.terminate;
    Worker.prototype.terminate = function () {
      state.terminated += 1;
      return originalTerminate.call(this);
    };
  });

  await page.getByRole("button", { name: "実行" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "The MCL operation timed out. Run it again.",
    {
      timeout: 15_000,
    },
  );
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as Window & { __playgroundWorkerState?: { terminated: number } })
            .__playgroundWorkerState?.terminated ?? 0,
      ),
    )
    .toBe(1);

  await page.getByRole("button", { name: "実行" }).click();
  await expectRendered(page, 'kind: "ConfigMap"');
});

test("times out a stalled worker startup and allows another run", async ({ page }) => {
  let releaseFirstRequest: (() => void) | undefined;
  let wasmRequests = 0;
  await page.route("**/mcl-*.wasm", async (route) => {
    wasmRequests += 1;
    if (wasmRequests === 1) {
      await new Promise<void>((resolve) => {
        releaseFirstRequest = resolve;
      });
      await route.fallback().catch(() => {});
      return;
    }
    await route.fallback();
  });
  await page.evaluate(() => {
    const state = { terminated: 0 };
    Object.defineProperty(window, "__playgroundWorkerState", { value: state });
    const originalTerminate = Worker.prototype.terminate;
    Worker.prototype.terminate = function () {
      state.terminated += 1;
      return originalTerminate.call(this);
    };
  });

  await page.getByRole("button", { name: "実行" }).click();
  await expect.poll(() => wasmRequests).toBe(1);
  await expect(page.getByRole("alert")).toContainText(
    "The MCL operation timed out. Run it again.",
    {
      timeout: 15_000,
    },
  );
  releaseFirstRequest?.();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as Window & { __playgroundWorkerState?: { terminated: number } })
            .__playgroundWorkerState?.terminated ?? 0,
      ),
    )
    .toBe(1);
  await page.getByRole("button", { name: "実行" }).click();
  await expectRendered(page, 'kind: "ConfigMap"');
  expect(wasmRequests).toBe(2);
});
