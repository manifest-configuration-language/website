import assert from "node:assert/strict";
import { it } from "node:test";
import {
  createProjectFragmentURL,
  createSharedProjectPayload,
  parseProjectFragment,
} from "./projectShare.ts";

it("round-trips UTF-8 and binary project files through a bounded fragment URL", async () => {
  const project = {
    source: 'import "modules/app.mcl"\nemit app',
    files: {
      "modules/app.mcl": { encoding: "utf8", content: "let app = 1" },
      "charts/chart.tgz": { encoding: "binary", bytes: new Uint8Array([0, 1, 127, 255]) },
    },
    activePath: "modules/app.mcl",
  };
  const baseURL = new URL("https://mcl.walnuts.dev/playground/?example=ignored#old");
  const url = await createProjectFragmentURL(createSharedProjectPayload(project), baseURL);

  assert.equal(url.pathname, "/playground/");
  assert.equal(url.search, "");
  assert.ok(url.href.length <= 4_096);
  const restored = await parseProjectFragment(url.hash);
  assert.deepEqual(
    { ...restored, files: Object.fromEntries(Object.entries(restored.files)) },
    project,
  );
});

it("rejects fragment projects above the expanded payload limit", async () => {
  const payload = {
    version: 1,
    source: "x".repeat(256 * 1024),
    files: {},
  };

  await assert.rejects(
    createProjectFragmentURL(payload, new URL("https://mcl.walnuts.dev/playground/")),
    /too large for a URL link/,
  );
});

it("rejects fragments that do not use the project payload format", async () => {
  await assert.rejects(
    parseProjectFragment("#project=not-base64!"),
    /Invalid shared project encoding/,
  );
});
