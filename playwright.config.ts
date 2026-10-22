import { defineConfig, devices } from "@playwright/test";

const containerImage = process.env.PRODUCTION_CONTAINER_IMAGE ?? "mcl-website:e2e";
if (!/^[A-Za-z0-9._/:@-]+$/.test(containerImage)) {
  throw new Error("PRODUCTION_CONTAINER_IMAGE contains unsupported characters.");
}

export default defineConfig({
  testDir: "./e2e",
  outputDir: ".build/playwright-results",
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:4322",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `docker run --rm --read-only --cap-drop=ALL --security-opt=no-new-privileges --user 10001:10001 --tmpfs /tmp:rw,noexec,nosuid,size=16m --publish 127.0.0.1:4322:8080 ${containerImage}`,
    url: "http://127.0.0.1:4322",
    reuseExistingServer: false,
    timeout: 30_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
