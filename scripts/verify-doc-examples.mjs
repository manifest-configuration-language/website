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
  const validFixture = fixture && /^[a-z0-9-]+$/.test(fixture);
  if (
    !modes.has(mode) ||
    (mode === "expected-error" && (!expectedError || tokens.length !== 2)) ||
    (mode === "verify" && tokens.length > 2) ||
    (mode !== "expected-error" && mode !== "verify" && tokens.length !== 1) ||
    (tokens.some((token) => token.startsWith("fixture=")) && !validFixture) ||
    (mode !== "verify" && fixture)
  ) {
    throw new Error(
      `${file}:${node.position.start.line}: invalid MCL fence metadata; use a mode (${[...modes].join(", ")}), optionally fixture=<name> for verify or error=<substring> for expected-error`,
    );
  }
  return { mode, expectedError, fixture };
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
  const classifications = new Map([...modes].map((mode) => [mode, 0]));
  const executableExamples = [];
  const expectedErrors = [];
  const fixtureCounts = new Map();
  for (const file of await markdownFiles(docsRoot)) {
    const source = await readFile(file, "utf8");
    const tree = unified().use(remarkParse).use(remarkMdx).parse(source);
    visit(tree, (node) => {
      if (node.type !== "code" || node.lang !== "mcl") return;
      const { mode, expectedError, fixture } = modeFor(node, relative(docsRoot, file));
      classifications.set(mode, classifications.get(mode) + 1);
      if (mode === "verify")
        executableExamples.push({
          file,
          line: node.position.start.line,
          source: node.value,
          fixture,
        });
      if (fixture) fixtureCounts.set(fixture, (fixtureCounts.get(fixture) ?? 0) + 1);
      if (mode === "expected-error")
        expectedErrors.push({
          file,
          line: node.position.start.line,
          source: node.value,
          expectedError,
        });
    });
  }
  if (executableExamples.length === 0)
    throw new Error("No executable MCL documentation examples are marked for verification");

  const cli = await getCli();
  try {
    for (const [index, example] of [...executableExamples, ...expectedErrors].entries()) {
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
      let failed = false;
      let output = "";
      try {
        execFileSync(cli.binary, ["check", sourcePath], { cwd: directory, stdio: "pipe" });
      } catch (error) {
        failed = true;
        output = `${error.stderr?.toString() ?? ""}${error.stdout?.toString() ?? ""}`.trim();
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
      if (index < executableExamples.length && failed) {
        throw new Error(
          `${relative(docsRoot, example.file)}:${example.line}: MCL ${release} rejected example ${index + 1}\n${output}`,
        );
      }
      if (index >= executableExamples.length) {
        if (!failed)
          throw new Error(
            `${relative(docsRoot, example.file)}:${example.line}: expected MCL ${release} to reject this example`,
          );
        if (!output.includes(example.expectedError))
          throw new Error(
            `${relative(docsRoot, example.file)}:${example.line}: expected diagnostic containing ${JSON.stringify(example.expectedError)}\n${output}`,
          );
      }
    }
  } finally {
    await rm(cli.directory, { recursive: true, force: true });
  }

  console.log(
    `Verified ${executableExamples.length} valid and ${expectedErrors.length} expected-error MCL examples with MCL ${release}.`,
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
