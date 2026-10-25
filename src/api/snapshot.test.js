import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { maximumSnapshotBytes, validateSnapshot } from "./snapshot.js";

describe("validateSnapshot", () => {
  it("normalizes a multi-file project and counts UTF-8 and binary content bytes", () => {
    const result = validateSnapshot({
      version: 1,
      source: "main 🐈",
      activePath: "schemas/config.json",
      files: {
        "schemas/config.json": { encoding: "utf8", content: "{}" },
        "charts/chart.tgz": { encoding: "binary", content: "AAEC_w" },
      },
    });

    assert.equal(result.snapshot.activePath, "schemas/config.json");
    assert.equal(result.contentBytes, Buffer.byteLength("main 🐈") + 2 + 4);
    assert.deepEqual(Object.keys(result.snapshot.files), [
      "schemas/config.json",
      "charts/chart.tgz",
    ]);
    assert.equal(JSON.parse(result.serialized.toString("utf8")).version, 1);
  });

  it("rejects paths that escape the project root", () => {
    assert.throws(
      () =>
        validateSnapshot({
          version: 1,
          source: "",
          files: { "../secret": { encoding: "utf8", content: "x" } },
        }),
      /Invalid shared project/,
    );
  });

  it("rejects malformed binary content and binary active files", () => {
    assert.throws(
      () =>
        validateSnapshot({
          version: 1,
          source: "",
          files: { "assets/file.bin": { encoding: "binary", content: "abc=" } },
        }),
      /Invalid shared project/,
    );
    assert.throws(
      () =>
        validateSnapshot({
          version: 1,
          source: "",
          activePath: "assets/file.bin",
          files: { "assets/file.bin": { encoding: "binary", content: "AA" } },
        }),
      /Invalid shared project/,
    );
  });

  it("rejects snapshots that exceed the project byte limit", () => {
    assert.throws(
      () =>
        validateSnapshot({
          version: 1,
          source: "x".repeat(maximumSnapshotBytes + 1),
          files: {},
        }),
      /Invalid shared project/,
    );
  });
});
