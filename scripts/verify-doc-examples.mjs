import { deepStrictEqual } from "node:assert";
import { execFileSync } from "node:child_process";
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { unified } from "unified";
import remarkMdx from "remark-mdx";
import remarkParse from "remark-parse";

const cli = "mcl";
const modes = new Set(["verify", "expected-error", "fragment", "release-gap"]);
const docsRoot = fileURLToPath(new URL("../src/content/docs/", import.meta.url));
const fixturesRoot = fileURLToPath(new URL("./doc-example-fixtures/", import.meta.url));
const snapshotsRoot = fileURLToPath(new URL("./doc-example-snapshots/", import.meta.url));
const updateSnapshots = process.argv.includes("--update-snapshots");

async function markdownFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory()
        ? markdownFiles(path)
        : /\.(md|mdx)$/.test(entry.name)
          ? [path]
          : [];
    }),
  );
  return files.flat();
}

function visit(node, callback) {
  callback(node);
  for (const child of node.children ?? []) visit(child, callback);
}

function modeFor(node, file) {
  const tokens = node.meta?.trim().split(/\s+/) ?? [];
  const mode = tokens[0];
  const expectedError = tokens.find((token) => token.startsWith("error="))?.slice("error=".length);
  const fixture = tokens.find((token) => token.startsWith("fixture="))?.slice("fixture=".length);
  const expectation = tokens.find((token) => token.startsWith("expect="))?.slice("expect=".length);
  const snapshot = tokens.find((token) => token.startsWith("snapshot="))?.slice("snapshot=".length);
  const validFixture = fixture && /^[a-z0-9-]+$/.test(fixture);
  const validExpectation =
    expectation &&
    expectation.split(",").every((entry) => {
      if (entry === "empty") return true;
      const separator = entry.indexOf("=");
      if (separator < 1 || separator === entry.length - 1) return false;
      const path = entry.slice(0, separator);
      const value = entry.slice(separator + 1);
      return (
        path.split(".").every((part) => /^(?:0|[1-9][0-9]*|[A-Za-z_][A-Za-z0-9_-]*)$/.test(part)) &&
        !value.includes(",")
      );
    });
  const fixtureTokens = tokens.filter((token) => token.startsWith("fixture="));
  const expectationTokens = tokens.filter((token) => token.startsWith("expect="));
  const snapshotTokens = tokens.filter((token) => token.startsWith("snapshot="));
  const errorTokens = tokens.filter((token) => token.startsWith("error="));
  if (
    !modes.has(mode) ||
    (mode === "expected-error" &&
      (!expectedError || errorTokens.length !== 1 || tokens.length !== 2)) ||
    (mode === "release-gap" &&
      (!expectedError ||
        errorTokens.length !== 1 ||
        fixtureTokens.length > 1 ||
        tokens.length !== 2 + fixtureTokens.length)) ||
    (mode === "verify" &&
      (!validExpectation ||
        !snapshot ||
        !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(snapshot) ||
        expectationTokens.length !== 1 ||
        snapshotTokens.length !== 1 ||
        errorTokens.length !== 0 ||
        fixtureTokens.length > 1 ||
        tokens.length !== 3 + fixtureTokens.length)) ||
    (mode !== "verify" &&
      mode !== "expected-error" &&
      mode !== "release-gap" &&
      tokens.length !== 1) ||
    fixtureTokens.length > 1 ||
    (fixtureTokens.length > 0 && !validFixture) ||
    (mode !== "verify" && mode !== "release-gap" && (fixture || expectation))
  ) {
    throw new Error(
      `${file}:${node.position.start.line}: invalid MCL fence metadata; verify requires expect=<path=value,...|empty> and may use fixture=<name>; expected-error requires error=<substring>`,
    );
  }
  return { mode, expectedError, fixture, expectation, snapshot };
}

function valueAtPath(value, path) {
  return path.split(".").reduce((current, part) => {
    if (current === undefined || current === null || !Object.hasOwn(current, part))
      return undefined;
    return current[part];
  }, value);
}

function verifyOutput(output, expectation, operationOutput) {
  const rendered = JSON.parse(output);
  const expectations = expectation.split(",");
  if (expectations.includes("empty")) {
    if (!Array.isArray(rendered) || rendered.length !== 0)
      throw new Error(`expected no rendered artifacts, received ${JSON.stringify(rendered)}`);
  }

  for (const entry of expectations) {
    if (entry === "empty") continue;
    const separator = entry.indexOf("=");
    const path = entry.slice(0, separator);
    const expected = entry.slice(separator + 1);
    const source = path.startsWith("lifecycle.") ? operationOutput?.["lifecycle.json"] : rendered;
    const actual = valueAtPath(source, path.startsWith("lifecycle.") ? path.slice(10) : path);
    let matches = String(actual) === expected;
    try {
      matches ||= JSON.stringify(actual) === JSON.stringify(JSON.parse(expected));
    } catch {}
    if (!matches) {
      throw new Error(
        `expected output ${path}=${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
      );
    }
  }
}

async function main() {
  const classifications = new Map([...modes].map((mode) => [mode, 0]));
  const executableExamples = [];
  const snapshotIds = new Map();
  const expectedErrors = [];
  const fixtureCounts = new Map();
  for (const file of await markdownFiles(docsRoot)) {
    const source = await readFile(file, "utf8");
    const tree = unified().use(remarkParse).use(remarkMdx).parse(source);
    visit(tree, (node) => {
      if (node.type !== "code" || node.lang !== "mcl") return;
      const { mode, expectedError, fixture, expectation, snapshot } = modeFor(
        node,
        relative(docsRoot, file),
      );
      classifications.set(mode, classifications.get(mode) + 1);
      if (mode === "verify")
        executableExamples.push({
          file,
          line: node.position.start.line,
          source: node.value,
          fixture,
          expectation,
          snapshot,
        });
      if (mode === "verify") {
        const previous = snapshotIds.get(snapshot);
        if (previous)
          throw new Error(
            `Duplicate documentation snapshot ${snapshot}: ${previous} and ${relative(docsRoot, file)}:${node.position.start.line}`,
          );
        snapshotIds.set(snapshot, `${relative(docsRoot, file)}:${node.position.start.line}`);
      }
      if (fixture) fixtureCounts.set(fixture, (fixtureCounts.get(fixture) ?? 0) + 1);
      if (mode === "expected-error" || mode === "release-gap")
        expectedErrors.push({
          file,
          line: node.position.start.line,
          source: node.value,
          expectedError,
          mode,
          fixture,
        });
    });
  }
  if (executableExamples.length === 0)
    throw new Error("No executable MCL documentation examples are marked for verification");

  for (const example of [...executableExamples, ...expectedErrors]) {
    const executable = executableExamples.includes(example);
    const directory = await mkdtemp(join(tmpdir(), "mcl-doc-example-"));
    const sourcePath = join(directory, "main.mcl");
    if (example.fixture) {
      const fixturePath = join(fixturesRoot, example.fixture);
      try {
        for (const name of await readdir(fixturePath)) {
          await cp(join(fixturePath, name), join(directory, name), {
            recursive: true,
            errorOnExist: false,
            force: true,
          });
        }
      } catch (error) {
        await rm(directory, { recursive: true, force: true });
        throw new Error(`Missing fixture ${example.fixture}: ${error.message}`);
      }
    }
    await writeFile(sourcePath, example.source);
    let checkFailure;
    let renderFailure;
    let output = "";
    let operationOutput;
    try {
      execFileSync(cli, ["check", sourcePath], { cwd: directory, stdio: "pipe" });
    } catch (error) {
      checkFailure = error;
    }
    if (!checkFailure && executable) {
      try {
        output = execFileSync(cli, ["render", "--format", "json", sourcePath], {
          cwd: directory,
          stdio: "pipe",
        }).toString();
        if (example.expectation.split(",").some((entry) => entry.startsWith("lifecycle."))) {
          const operationDirectory = join(directory, "operation-output");
          execFileSync(
            cli,
            [
              "render",
              "--operation",
              "create",
              "--output-dir",
              operationDirectory,
              "--format",
              "json",
              sourcePath,
            ],
            { cwd: directory, stdio: "pipe" },
          );
          operationOutput = {};
          for (const name of (await readdir(operationDirectory)).sort()) {
            const contents = await readFile(join(operationDirectory, name), "utf8");
            try {
              operationOutput[name] = JSON.parse(contents);
            } catch {
              operationOutput[name] = contents;
            }
          }
        }
      } catch (error) {
        renderFailure = error;
      }
    }
    await rm(directory, { recursive: true, force: true });
    const checkOutput = (error) =>
      `${error.stderr?.toString() ?? ""}${error.stdout?.toString() ?? ""}`.trim();
    if (executable && checkFailure) {
      throw new Error(
        `${relative(docsRoot, example.file)}:${example.line}: MCL CLI rejected example during check\n${checkOutput(checkFailure)}`,
      );
    }
    if (executable && renderFailure) {
      throw new Error(
        `${relative(docsRoot, example.file)}:${example.line}: MCL CLI could not render example\n${checkOutput(renderFailure)}`,
      );
    }
    if (executable) {
      try {
        const actualSnapshot = { render: JSON.parse(output) };
        if (operationOutput) actualSnapshot.operation = operationOutput;
        const snapshotPath = join(snapshotsRoot, `${example.snapshot}.json`);
        if (updateSnapshots) {
          await writeFile(snapshotPath, `${JSON.stringify(actualSnapshot, null, 2)}\n`);
        } else {
          const expectedSnapshot = JSON.parse(await readFile(snapshotPath, "utf8"));
          deepStrictEqual(actualSnapshot, expectedSnapshot);
        }
        verifyOutput(output, example.expectation, operationOutput);
      } catch (error) {
        throw new Error(
          `${relative(docsRoot, example.file)}:${example.line} [${example.snapshot}]: ${error.message}`,
        );
      }
    } else {
      if (!checkFailure)
        throw new Error(
          `${relative(docsRoot, example.file)}:${example.line}: ${example.mode === "release-gap" ? `release gap is resolved in the installed MCL CLI; mark this example verify and add an expectation` : `expected the installed MCL CLI to reject this example`}`,
        );
      if (!checkOutput(checkFailure).includes(example.expectedError))
        throw new Error(
          `${relative(docsRoot, example.file)}:${example.line}: expected diagnostic containing ${JSON.stringify(example.expectedError)}\n${checkOutput(checkFailure)}`,
        );
    }
  }

  if (!updateSnapshots) {
    const snapshotFiles = (await readdir(snapshotsRoot)).filter((name) => name.endsWith(".json"));
    const expectedFiles = new Set([...snapshotIds.keys()].map((name) => `${name}.json`));
    const unreferenced = snapshotFiles.filter((name) => !expectedFiles.has(name));
    if (unreferenced.length)
      throw new Error(`Unreferenced documentation snapshots: ${unreferenced.join(", ")}`);
  }

  console.log(
    `Verified ${executableExamples.length} valid, ${classifications.get("expected-error")} expected-error, and ${classifications.get("release-gap")} release-gap MCL examples with the installed MCL CLI.`,
  );
  console.log(
    `Classified MCL fences: ${[...classifications].map(([mode, count]) => `${mode}=${count}`).join(", ")}.`,
  );
  console.log(
    `Fixture-backed examples: ${[...fixtureCounts].map(([name, count]) => `${name}=${count}`).join(", ") || "none"}.`,
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
