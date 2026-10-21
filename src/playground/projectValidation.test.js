import assert from "node:assert/strict";
import test from "node:test";
import { validateProjectInput } from "./projectValidation.js";

test("counts UTF-8 and canonical Base64 project bytes", () => {
  assert.equal(
    validateProjectInput("", {
      "unicode.txt": { encoding: "utf8", content: "雪" },
      "binary.bin": { encoding: "base64", content: "AQI=" },
    }),
    true,
  );
  assert.equal(
    validateProjectInput("", { "binary.bin": { encoding: "base64", content: "AB==" } }),
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
