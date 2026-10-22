import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";

const execFileAsync = promisify(execFile);
const root = path.resolve(import.meta.dirname, "..");
const packageManifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const version = packageManifest.dependencies["@manifest-configuration-language/browser"];
const operatingSystems = { darwin: "darwin", linux: "linux" };
const architectures = { x64: "amd64", arm64: "arm64" };
const os = operatingSystems[process.platform];
const arch = architectures[process.arch];
if (!version || !os || !arch) {
  throw new Error("Documentation example verification requires a Linux or macOS MCL release CLI.");
}

const buildDirectory = path.join(root, ".build");
const binaryDirectory = path.join(buildDirectory, "bin");
const archivePath = path.join(buildDirectory, "mcl-cli.tar.gz");
const binaryPath = path.join(binaryDirectory, "mcl");
await mkdir(binaryDirectory, { recursive: true });
const filename = `mcl_${version}_${os}_${arch}.tar.gz`;
const releaseUrl = `https://github.com/manifest-configuration-language/mcl/releases/download/v${version}`;
const headers = { "User-Agent": "mcl-website-doc-check" };
const [archiveResponse, checksumsResponse] = await Promise.all([
  fetch(`${releaseUrl}/${filename}`, { headers }),
  fetch(`${releaseUrl}/SHA256SUMS`, { headers }),
]);
if (!archiveResponse.ok)
  throw new Error(`Unable to download MCL ${version} CLI: HTTP ${archiveResponse.status}`);
if (!checksumsResponse.ok)
  throw new Error(`Unable to download MCL ${version} checksums: HTTP ${checksumsResponse.status}`);
const archive = Buffer.from(await archiveResponse.arrayBuffer());
const checksumEntry = (await checksumsResponse.text())
  .split(/\r?\n/)
  .map((line) => /^([a-f\d]{64})\s+\*?(.+)$/.exec(line))
  .find((match) => match?.[2] === filename);
if (!checksumEntry) throw new Error(`MCL ${version} SHA256SUMS has no entry for ${filename}`);
const digest = createHash("sha256").update(archive).digest("hex");
if (digest !== checksumEntry[1]) throw new Error(`MCL ${version} CLI checksum mismatch for ${filename}`);
await writeFile(archivePath, archive);
await rm(binaryPath, { force: true });
try {
  await execFileAsync("tar", ["-xzf", archivePath, "-C", binaryDirectory, "mcl"]);
} finally {
  await rm(archivePath, { force: true });
}
