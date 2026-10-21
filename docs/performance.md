# Website performance baseline

Run `pnpm run build && pnpm exec playwright install chromium && node scripts/measure-performance.mjs` after a production build. The script starts an Astro preview server behind a local HTTP proxy, opens `/reference/` and `/playground/` in fresh Chromium contexts, runs the Playground twice, opens Search, measures cancellation UI response, and renders a project with two 15.9 MiB binary files. The proxy serves the fingerprinted WASM from the production build with `Content-Type: application/wasm` and `Content-Encoding: gzip` on the same origin, so Chromium uses `WebAssembly.instantiateStreaming` with HTTP decompression. The worker bundle is instrumented in the test context to time that call and inspect the exported Go WASM memory.

Baseline captured on 2026-10-22 from a local Apple Silicon macOS machine with Node.js 26.8.2 and Chromium 156.0.8078.4. Asset totals use response body bytes and exclude HTTP headers. The Playground downloads the fingerprinted 19,598,887-byte gzip WASM asset only when the user runs MCL. Timings are single-run observations affected by machine load and browser state; they are diagnostic values, not acceptance thresholds.

| Page           | Initial HTML | Initial JavaScript |  Initial CSS | Initial other | Navigation load | FCP proxy | LCP proxy | CLS proxy |
| -------------- | -----------: | -----------------: | -----------: | ------------: | --------------: | --------: | --------: | --------: |
| `/reference/`  | 26,307 bytes |      102,158 bytes | 68,074 bytes |       0 bytes |           37 ms |     24 ms |     36 ms |         0 |
| `/playground/` | 28,369 bytes |      625,989 bytes | 68,074 bytes |       0 bytes |           34 ms |     20 ms |     36 ms |    0.0523 |

The reference page does not load MCL WASM or create a CodeMirror editor. Search loads 155,476 bytes of Pagefind resources, including its 68,199-byte WASM file. The Playground creates CodeMirror without loading MCL WASM. Its first execution, including Worker startup, WASM transfer, runtime startup, and rendering, took 822 ms; the second took 44 ms. The `WebAssembly.instantiateStreaming` call took 157 ms from invocation until its promise resolved. That interval includes any remaining streamed response transfer as well as WebAssembly compilation and instantiation; it is not a compile-only duration. After execution, the Worker and WASM assets totaled 19,935,797 bytes, including the 336,910-byte Worker bundle with `wasm_exec.js`.

The project-import run accepted 33,344,717 bytes across three files in 74 ms and rendered in 502 ms. The cancel interaction returned the UI to the Run button in 33 ms while the compressed WASM request was held. This measures UI response, not worker computation time.

The Go WebAssembly module's exported `mem.buffer.byteLength` was 49,545,216 bytes immediately after instantiation, 89,194,496 bytes after the first render, and 144,441,344 bytes after rendering the 31.8 MiB binary project. These values are the current capacity of the WASM linear memory, not the number of bytes actively used by Go, resident physical memory, or total browser memory. They exclude JavaScript heap, DOM, browser process overhead, and other worker allocations. WebAssembly memory grows but does not shrink, so the last value is the largest linear-memory capacity reached in that run; it is not an overall browser peak-memory measurement.

The results do not measure a production CDN, real user devices, a full Web Vitals session, INP, or enforce performance budgets.
