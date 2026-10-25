import { readdir } from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { createBrotliCompress, constants } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const dist = fileURLToPath(new URL("../.build/dist/", import.meta.url));

async function* files(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      yield* files(path);
    } else if (entry.isFile() && entry.name.endsWith(".wasm")) {
      yield path;
    }
  }
}

let count = 0;
for await (const path of files(dist)) {
  await pipeline(
    createReadStream(path),
    createBrotliCompress({
      params: {
        [constants.BROTLI_PARAM_QUALITY]: 5,
        [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_GENERIC,
      },
    }),
    createWriteStream(`${path}.br`),
  );
  count += 1;
}

if (count === 0) {
  throw new Error(`No WASM assets found in ${dist}`);
}

console.log(`Created Brotli sidecars for ${count} WASM asset(s).`);
