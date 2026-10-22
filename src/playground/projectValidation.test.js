import assert from "node:assert/strict";
import test from "node:test";
import { validateProjectInput } from "./projectValidation.js";

test("counts UTF-8 and binary project bytes without decoding", () => {
  assert.equal(
    validateProjectInput(
      "",
      {
        "unicode.txt": { encoding: "utf8", content: "雪" },
        "binary.bin": { encoding: "binary" },
      },
      { "binary.bin": new Uint8Array([1, 2]) },
    ),
    true,
  );
  assert.equal(validateProjectInput("", { "binary.bin": { encoding: "binary" } }), false);
  assert.equal(
    validateProjectInput(
      "",
      { "binary.bin": { encoding: "binary" } },
      { other: new Uint8Array(1) },
    ),
    false,
  );
});

test("enforces the project file count including the entrypoint", () => {
  const atLimit = Object.fromEntries(
    Array.from({ length: 4095 }, (_, index) => [
      `file-${index}`,
      { encoding: "utf8", content: "" },
    ]),
  );
  const overLimit = { ...atLimit, extra: { encoding: "utf8", content: "" } };

  assert.equal(validateProjectInput("", atLimit), true);
  assert.equal(validateProjectInput("", overLimit), false);
});

test("rejects project paths rooted on a Windows drive", () => {
  for (const path of ["C:/manifest.mcl", "c:manifest.mcl"]) {
    assert.equal(validateProjectInput("", { [path]: { encoding: "utf8", content: "" } }), false);
  }
});
