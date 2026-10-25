import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createApp } from "./server.js";

function createStorage() {
  const snapshots = new Map();
  return {
    allowRequest: async () => true,
    allowUploadBytes: async () => true,
    async createShare({ id, serialized }) {
      const expiresAt = new Date(Date.now() + 60_000).toISOString();
      snapshots.set(id, {
        snapshot: JSON.parse(serialized.toString("utf8")),
        runtimeVersion: "0.3.12",
      });
      return { id, expiresAt };
    },
    async getShare(id) {
      return snapshots.get(id);
    },
    snapshots,
  };
}

const headers = { "content-type": "application/json" };

describe("Playground share API", () => {
  it("keeps rate-limit keys stable across fixed-window boundaries", async (testContext) => {
    const storage = createStorage();
    const requestLimits = [];
    const uploadLimits = [];
    let now = 3_599_999;
    testContext.mock.method(Date, "now", () => now);
    storage.allowRequest = async (...args) => {
      requestLimits.push(args);
      return true;
    };
    storage.allowUploadBytes = async (...args) => {
      uploadLimits.push(args);
      return true;
    };
    const app = createApp(storage, { rateLimitSecret: "test-secret" });
    const snapshot = { version: 1, source: "", files: {} };
    const requestHeaders = { ...headers, "cf-connecting-ip": "192.0.2.1" };

    for (const timestamp of [3_599_999, 3_600_000]) {
      now = timestamp;
      const response = await app.request("/api/playground/snippets", {
        method: "POST",
        headers: requestHeaders,
        body: JSON.stringify(snapshot),
      });
      assert.equal(response.status, 201);
    }
    for (const timestamp of [86_399_999, 86_400_000]) {
      now = timestamp;
      const response = await app.request("/api/playground/snippets/not-a-share-id", {
        headers: requestHeaders,
      });
      assert.equal(response.status, 404);
    }

    const postLimits = requestLimits.filter(([, limit]) => limit === 6);
    const getLimits = requestLimits.filter(([, limit]) => limit === 120);
    assert.equal(postLimits[0][0], postLimits[1][0]);
    assert.deepEqual(postLimits[0].slice(1), [6, 60 * 60]);
    assert.equal(getLimits[0][0], getLimits[1][0]);
    assert.deepEqual(getLimits[0].slice(1), [120, 60]);
    assert.equal(uploadLimits[0][0], uploadLimits[1][0]);
  });

  it("creates an immutable short link for a multi-file project and returns its snapshot", async () => {
    const storage = createStorage();
    const app = createApp(storage, { rateLimitSecret: "test-secret" });
    const snapshot = {
      version: 1,
      source: 'import "modules/app.mcl"\nemit app\n',
      activePath: "modules/app.mcl",
      files: {
        "modules/app.mcl": { encoding: "utf8", content: 'let app = "demo"\n' },
        "charts/demo.tgz": { encoding: "binary", content: "AAEC_w" },
      },
    };

    const created = await app.request("/api/playground/snippets", {
      method: "POST",
      headers,
      body: JSON.stringify(snapshot),
    });
    assert.equal(created.status, 201);
    assert.equal(created.headers.get("cache-control"), "no-store");
    assert.equal(created.headers.get("x-content-type-options"), "nosniff");
    assert.equal(created.headers.get("referrer-policy"), "no-referrer");

    const link = await created.json();
    assert.match(link.id, /^[A-Za-z0-9_-]{22}$/);
    assert.ok(Number.isFinite(Date.parse(link.expiresAt)));

    const retrieved = await app.request(`/api/playground/snippets/${link.id}`);
    assert.equal(retrieved.status, 200);
    assert.equal(retrieved.headers.get("x-mcl-runtime-version"), "0.3.12");
    assert.deepEqual(await retrieved.json(), snapshot);

    const update = await app.request(`/api/playground/snippets/${link.id}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ ...snapshot, source: "emit changed" }),
    });
    assert.equal(update.status, 404);
    assert.deepEqual(storage.snapshots.get(link.id).snapshot, snapshot);
  });

  it("rejects malformed projects and share IDs", async () => {
    const storage = createStorage();
    const app = createApp(storage, { rateLimitSecret: "test-secret" });

    const invalidProject = await app.request("/api/playground/snippets", {
      method: "POST",
      headers,
      body: JSON.stringify({ version: 1, source: "", files: { "../secret": "x" } }),
    });
    assert.equal(invalidProject.status, 400);
    assert.deepEqual(await invalidProject.json(), { error: "Invalid shared project" });
    assert.equal(storage.snapshots.size, 0);

    const invalidID = await app.request("/api/playground/snippets/not-a-share-id");
    assert.equal(invalidID.status, 404);
    assert.deepEqual(await invalidID.json(), { error: "Not found" });
    assert.equal(storage.snapshots.size, 0);
  });
});
