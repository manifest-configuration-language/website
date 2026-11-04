import assert from "node:assert/strict";
import { test } from "node:test";
import { isCurrentEditorRequest } from "./playgroundRequest.ts";

test("a response for a previous file cannot act on the newly selected file", () => {
  const editor = {};
  const request = {
    revision: 4,
    expectedRevision: 4,
    editor,
    expectedEditor: editor,
    activePath: "b.mcl",
    expectedPath: "a.mcl",
    source: "emit A",
    currentSource: "emit B",
  };

  assert.equal(isCurrentEditorRequest(request), false);
});

test("a response is current only while its editor source remains unchanged", () => {
  const editor = {};
  const request = {
    revision: 4,
    expectedRevision: 4,
    editor,
    expectedEditor: editor,
    activePath: "a.mcl",
    expectedPath: "a.mcl",
    source: "emit A",
    currentSource: "emit A",
  };

  assert.equal(isCurrentEditorRequest(request), true);
  assert.equal(isCurrentEditorRequest({ ...request, currentSource: "emit changed" }), false);
});
