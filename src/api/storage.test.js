import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { describe, it } from "node:test";
import { decodeShareObject } from "./storage.js";
import { validateSnapshot } from "./snapshot.js";

function storedShare(project) {
  const validated = validateSnapshot(project);
  const compressed = gzipSync(validated.serialized);
  return {
    compressed,
    storedBytes: compressed.byteLength,
    contentBytes: validated.contentBytes,
    contentSha256: createHash("sha256").update(validated.serialized).digest("hex"),
    serializedBytes: validated.serialized.byteLength,
    snapshot: validated.snapshot,
  };
}

const project = {
  version: 1,
  source: ['let app = "雪"', "emit app", ""].join("\n"),
  files: {
    "modules/app.mcl": { encoding: "utf8", content: ['let name = "demo"', ""].join("\n") },
    "charts/demo.tgz": { encoding: "binary", content: "AAEC_w" },
  },
};

describe("decodeShareObject", () => {
  it("validates a compressed multi-file snapshot using its original content byte count", async () => {
    const share = storedShare(project);
    assert.notEqual(share.serializedBytes, share.contentBytes);

    const decoded = await decodeShareObject(share);

    assert.deepEqual(decoded, share.snapshot);
  });

  it("rejects compressed objects whose content metadata does not match the snapshot", async () => {
    const share = storedShare(project);

    await assert.rejects(decodeShareObject({ ...share, contentBytes: share.contentBytes + 1 }), {
      message: "Share object is corrupt",
    });
  });

  it("rejects compressed objects whose integrity digest does not match", async () => {
    const share = storedShare(project);

    await assert.rejects(decodeShareObject({ ...share, contentSha256: "0".repeat(64) }), {
      message: "Share object is corrupt",
    });
  });
});
