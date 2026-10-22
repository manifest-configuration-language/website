import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { unified } from "unified";
import remarkMdx from "remark-mdx";
import remarkParse from "remark-parse";

const release = "v0.1.0";
const releaseAssets = {
  "darwin-arm64": [
    "mcl_0.1.0_darwin_arm64.tar.gz",
    "0c8cbb96548bd25b4e8ecc9d5cb6c61467f1a3cfca975a6469843890b4c1b78d",
    "mcl-darwin-arm64",
  ],
  "darwin-x64": [
    "mcl_0.1.0_darwin_amd64.tar.gz",
    "21167d353f0c8b1ffab1f4f0da68f010db0ba78e4b83cb44f67ce96c4ce1c0aa",
    "mcl-darwin-amd64",
  ],
  "linux-arm64": [
    "mcl_0.1.0_linux_arm64.tar.gz",
    "5a8b7c517ae289bb607b32db71733628611a74c82972e03c98603439f52cbcca",
    "mcl-linux-arm64",
  ],
  "linux-x64": [
    "mcl_0.1.0_linux_amd64.tar.gz",
    "e2b230c2d81b3fad715433e231b766b41600395d0ac3462c3f85be3c986ec4ba",
    "mcl-linux-amd64",
  ],
};
const modes = new Set(["verify", "expected-error", "fragment", "release-gap"]);
const docsRoot = fileURLToPath(new URL("../src/content/docs/", import.meta.url));
const fixturesRoot = fileURLToPath(new URL("./doc-example-fixtures/", import.meta.url));

async function verifyLatestRelease() {
  const headers = { accept: "application/vnd.github+json" };
  if (process.env.GH_TOKEN) headers.authorization = `Bearer ${process.env.GH_TOKEN}`;
  const response = await fetch(
    "https://api.github.com/repos/manifest-configuration-language/mcl/releases/latest",
    {
      headers,
    },
  );
  if (!response.ok)
    throw new Error(`Checking the latest MCL release failed: HTTP ${response.status}`);
  const latestRelease = (await response.json()).tag_name;
  if (latestRelease !== release) {
    throw new Error(
      `Documentation examples use MCL ${release}, but the latest stable release is ${latestRelease}`,
    );
  }
}

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
        expectationTokens.length !== 1 ||
        errorTokens.length !== 0 ||
        fixtureTokens.length > 1 ||
        tokens.length !== 2 + fixtureTokens.length)) ||
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
  return { mode, expectedError, fixture, expectation };
}

function valueAtPath(value, path) {
  return path.split(".").reduce((current, part) => {
    if (current === undefined || current === null || !Object.hasOwn(current, part))
      return undefined;
    return current[part];
  }, value);
}

function verifyOutput(output, expectation, lifecycleOutput) {
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
    const source = path.startsWith("lifecycle.") ? JSON.parse(lifecycleOutput) : rendered;
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

async function getCli() {
  const platform = `${process.platform}-${process.arch}`;
  const asset = releaseAssets[platform];
  if (!asset) throw new Error(`No checksum-pinned MCL ${release} binary for ${platform}`);
  const [name, expectedDigest, executableName] = asset;
  const directory = await mkdtemp(join(tmpdir(), "mcl-doc-verification-"));
  const archive = join(directory, name);
  const response = await fetch(
    `https://github.com/manifest-configuration-language/mcl/releases/download/${release}/${name}`,
  );
  if (!response.ok) throw new Error(`Downloading MCL ${release} failed: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== expectedDigest) throw new Error(`MCL ${release} checksum mismatch: ${digest}`);
  await writeFile(archive, bytes);
  execFileSync("tar", ["-xzf", archive, "-C", directory], { stdio: "pipe" });
  return { binary: join(directory, executableName), directory };
}

async function main() {
  await verifyLatestRelease();
  const classifications = new Map([...modes].map((mode) => [mode, 0]));
  const executableExamples = [];
  const expectedErrors = [];
  const fixtureCounts = new Map();
  for (const file of await markdownFiles(docsRoot)) {
    const source = await readFile(file, "utf8");
    const tree = unified().use(remarkParse).use(remarkMdx).parse(source);
    visit(tree, (node) => {
      if (node.type !== "code" || node.lang !== "mcl") return;
      const { mode, expectedError, fixture, expectation } = modeFor(node, relative(docsRoot, file));
      classifications.set(mode, classifications.get(mode) + 1);
      if (mode === "verify")
        executableExamples.push({
          file,
          line: node.position.start.line,
          source: node.value,
          fixture,
          expectation,
        });
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

  const cli = await getCli();
  try {
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
      let lifecycleOutput;
      try {
        execFileSync(cli.binary, ["check", sourcePath], { cwd: directory, stdio: "pipe" });
      } catch (error) {
        checkFailure = error;
      }
      if (!checkFailure && executable) {
        try {
          output = execFileSync(cli.binary, ["render", "--format", "json", sourcePath], {
            cwd: directory,
            stdio: "pipe",
          }).toString();
          if (example.expectation.split(",").some((entry) => entry.startsWith("lifecycle."))) {
            const operationDirectory = join(directory, "operation-output");
            execFileSync(
              cli.binary,
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
            lifecycleOutput = await readFile(join(operationDirectory, "lifecycle.json"), "utf8");
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
          `${relative(docsRoot, example.file)}:${example.line}: MCL ${release} rejected example during check\n${checkOutput(checkFailure)}`,
        );
      }
      if (executable && renderFailure) {
        throw new Error(
          `${relative(docsRoot, example.file)}:${example.line}: MCL ${release} could not render example\n${checkOutput(renderFailure)}`,
        );
      }
      if (executable) {
        try {
          verifyOutput(output, example.expectation, lifecycleOutput);
        } catch (error) {
          throw new Error(`${relative(docsRoot, example.file)}:${example.line}: ${error.message}`);
        }
      } else {
        if (!checkFailure)
          throw new Error(
            `${relative(docsRoot, example.file)}:${example.line}: ${example.mode === "release-gap" ? `release gap is resolved in MCL ${release}; mark this example verify and add an expectation` : `expected MCL ${release} to reject this example`}`,
          );
        if (!checkOutput(checkFailure).includes(example.expectedError))
          throw new Error(
            `${relative(docsRoot, example.file)}:${example.line}: expected diagnostic containing ${JSON.stringify(example.expectedError)}\n${checkOutput(checkFailure)}`,
          );
      }
    }
  } finally {
    await rm(cli.directory, { recursive: true, force: true });
  }

  console.log(
    `Verified ${executableExamples.length} valid, ${classifications.get("expected-error")} expected-error, and ${classifications.get("release-gap")} release-gap MCL examples with MCL ${release}.`,
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
