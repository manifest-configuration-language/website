import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import * as tar from "tar";

const websiteRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(join(websiteRoot, "package.json"), "utf8"));
const version = packageJson.dependencies?.["@manifest-configuration-language/browser"];
if (typeof version !== "string" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error("The pinned Browser SDK version must be an exact semantic version.");
}
if (packageJson.dependencies?.["@manifest-configuration-language/language"] !== version) {
  throw new Error("The Browser SDK and Language SDK versions must match.");
}

const archiveName = `mcl_reference_${version}.tar.gz`;
const releaseBase = `https://github.com/manifest-configuration-language/mcl/releases/download/v${version}`;
const archiveOverride = process.env.MCL_REFERENCE_ARCHIVE;
const checksumOverride = process.env.MCL_REFERENCE_CHECKSUMS;

async function fetchBytes(url, limit) {
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`Could not download ${url}: HTTP ${response.status}`);
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > limit) {
    throw new Error(`Downloaded file exceeds the ${limit}-byte limit.`);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error(`Response has no body: ${url}`);
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new Error(`Downloaded file exceeds the ${limit}-byte limit.`);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, size);
}

async function getInputs() {
  if (archiveOverride) {
    const archivePath = resolve(archiveOverride);
    const checksumPath = resolve(checksumOverride ?? join(dirname(archivePath), "SHA256SUMS"));
    return {
      archive: await readFile(archivePath),
      checksums: await readFile(checksumPath, "utf8"),
    };
  }
  if (checksumOverride) throw new Error("MCL_REFERENCE_CHECKSUMS requires MCL_REFERENCE_ARCHIVE.");
  const [checksums, archive] = await Promise.all([
    fetchBytes(`${releaseBase}/SHA256SUMS`, 1_000_000),
    fetchBytes(`${releaseBase}/${archiveName}`, 16 * 1024 * 1024),
  ]);
  return { archive, checksums: checksums.toString("utf8") };
}

function expectedDigest(checksums) {
  const matches = [...checksums.matchAll(/^([a-fA-F0-9]{64})[ \t]+\*?([^\r\n]+)$/gm)]
    .filter((match) => match[2] === archiveName);
  if (matches.length !== 1) throw new Error(`SHA256SUMS must contain exactly one entry for ${archiveName}.`);
  return matches[0][1].toLowerCase();
}

async function readArchiveEntries(archive) {
  if (archive.byteLength > 16 * 1024 * 1024) throw new Error("The reference archive exceeds 16 MiB.");
  const files = new Map();
  const contents = new Map();
  let entryCount = 0;
  let totalFileBytes = 0;
  let validationError;
  const temporaryRoot = await mkdtemp(join(tmpdir(), "mcl-reference-"));
  const archivePath = join(temporaryRoot, "reference.tar.gz");
  await writeFile(archivePath, archive, { flag: "wx" });
  try {
    await tar.t({
      file: archivePath,
      strict: true,
      maxDecompressionRatio: 100,
      maxMetaEntrySize: 64 * 1024,
      filter(path, entry) {
        entryCount += 1;
        const normalizedPath = path.replace(/\/$/, "");
        const isDirectory = entry.type === "Directory";
        const isFile = entry.type === "File" || entry.type === "OldFile";
        const allowedPath = normalizedPath === "reference" || normalizedPath === "reference/cli" ||
          normalizedPath === "reference/stdlib-functions.md" || /^reference\/cli\/[A-Za-z0-9._-]+\.md$/.test(normalizedPath);
        if (entryCount > 100) validationError ??= new Error("The reference archive has too many entries.");
        else if (!allowedPath) validationError ??= new Error(`Unexpected path in reference archive: ${path}`);
        else if ((!isDirectory && !isFile) || (isDirectory && entry.size !== 0)) {
          validationError ??= new Error(`Unsupported tar entry type for ${path}.`);
        } else if (isFile && entry.size > 1_000_000) {
          validationError ??= new Error(`Reference file exceeds 1 MiB: ${path}`);
        } else if (isFile && files.has(normalizedPath)) {
          validationError ??= new Error(`Duplicate file in reference archive: ${path}`);
        } else if (isFile && totalFileBytes + entry.size > 8 * 1024 * 1024) {
          validationError ??= new Error("Reference files exceed 8 MiB total.");
        }
        if (!validationError && isFile) {
          files.set(normalizedPath, entry.size);
          totalFileBytes += entry.size;
        }
        return !validationError;
      },
      onReadEntry(entry) {
        if (entry.type !== "File" && entry.type !== "OldFile") return;
        const chunks = [];
        let bytesRead = 0;
        entry.on("data", (chunk) => {
          bytesRead += chunk.byteLength;
          chunks.push(chunk);
        });
        entry.on("end", () => {
          if (bytesRead !== entry.size) {
            validationError ??= new Error(`Truncated tar entry: ${entry.path}`);
          } else {
            contents.set(entry.path, Buffer.concat(chunks, bytesRead));
          }
        });
      },
    });
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
  if (validationError) throw validationError;
  if ([...files.keys()].some((path) => !contents.has(path))) throw new Error("The reference archive contains incomplete files.");
  if (files.size !== contents.size) throw new Error("The reference archive contains unexpected file entries.");
  if (!files.has("reference/cli/mcl.md") || !files.has("reference/stdlib-functions.md")) {
    throw new Error("The reference archive is missing its CLI root or standard-library index.");
  }
  return contents;
}

const { archive, checksums } = await getInputs();
const actualDigest = createHash("sha256").update(archive).digest("hex");
if (actualDigest !== expectedDigest(checksums)) throw new Error(`SHA-256 verification failed for ${archiveName}.`);
const files = await readArchiveEntries(archive);

const docsRoot = join(websiteRoot, "src/content/docs/reference");
const generatedCli = join(docsRoot, "cli-commands");
const generatedFunctions = join(docsRoot, "stdlib-functions.md");
const stagingRoot = join(docsRoot, `.reference-staging-${process.pid}`);
await rm(stagingRoot, { recursive: true, force: true });
await mkdir(join(stagingRoot, "cli-commands"), { recursive: true });
const commandFiles = [...files.keys()]
  .filter((path) => path.startsWith("reference/cli/"))
  .map((path) => path.slice("reference/cli/".length))
  .sort();
const commandLinks = commandFiles.map((basename) => {
  const slug = basename.slice(0, -3);
  const label = basename === "mcl.md" ? "mcl" : `mcl ${slug.slice("mcl_".length).replaceAll("_", " ")}`;
  return `- [\`${label}\`](./${slug}/)`;
});
await writeFile(
  join(stagingRoot, "cli-commands", "index.md"),
  `---\ntitle: "CLIコマンド"\n---\n\n# CLIコマンド\n\n${commandLinks.join("\n")}\n`,
  { flag: "wx" },
);
for (const [path, content] of files) {
  if (path.startsWith("reference/cli/")) {
    const basename = path.slice("reference/cli/".length);
    const title = basename === "mcl.md" ? "mcl" : `mcl ${basename.slice("mcl_".length, -3).replaceAll("_", " ")}`;
    await writeFile(join(stagingRoot, "cli-commands", basename), `---\ntitle: "${title}"\n---\n\n${content.toString("utf8")}`, { flag: "wx" });
  } else if (path === "reference/stdlib-functions.md") {
    const contentText = content.toString("utf8").replace(/^MCL version: `[^`]+`\n\n/, "");
    await writeFile(join(stagingRoot, "stdlib-functions.md"), `---\ntitle: "標準関数一覧"\n---\n\n${contentText}`, { flag: "wx" });
  }
}

await rm(generatedCli, { recursive: true, force: true });
await rm(generatedFunctions, { force: true });
await rename(join(stagingRoot, "cli-commands"), generatedCli);
await rename(join(stagingRoot, "stdlib-functions.md"), generatedFunctions);
await rm(stagingRoot, { recursive: true, force: true });
console.log(`Generated CLI and standard-library references for MCL ${version}.`);
