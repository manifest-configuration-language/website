# Website performance baseline

Run `pnpm run build && pnpm exec playwright install chromium && node scripts/measure-performance.mjs` after a production build. The script starts an Astro preview server and a local HTTP endpoint for the compressed WASM asset, opens `/reference/` and `/playground/` in fresh Chromium contexts, runs the Playground twice, opens Search, measures cancellation UI response, and renders a project with two 15.9 MiB binary files. The local endpoint sends the compressed asset with `Content-Type: application/wasm` and `Content-Encoding: gzip`, so Chromium exercises `WebAssembly.instantiateStreaming` with HTTP decompression.

Baseline captured on 2026-10-22 from a local Apple Silicon macOS machine with Node.js 26.8.2 and Chromium 156.0.8078.4. Asset totals use response body bytes and exclude HTTP headers. The Playground downloads the fingerprinted 19,598,887-byte gzip WASM asset only when the user runs MCL. Timings are single-run observations affected by machine load, browser cache state, and network conditions; they are diagnostic values, not acceptance thresholds.

| Page | Initial HTML | Initial JavaScript | Initial CSS | Initial other | Navigation load | FCP proxy | LCP proxy | CLS proxy |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `/reference/` | 25,221 bytes | 102,158 bytes | 68,074 bytes | 0 bytes | 41 ms | 24 ms | 44 ms | 0 |
| `/playground/` | 27,283 bytes | 625,989 bytes | 68,074 bytes | 0 bytes | 32 ms | 20 ms | 32 ms | 0.0523 |

The reference page does not load MCL WASM or create a CodeMirror editor. Search loads 155,447 bytes of Pagefind resources, including its 68,199-byte WASM file. The Playground creates CodeMirror without loading MCL WASM. Its first execution, including Worker startup, WASM streaming instantiation, and rendering, took 824 ms; the second took 44 ms. After execution, the Worker and WASM assets totaled 19,935,452 bytes, including the 336,565-byte Worker bundle with `wasm_exec.js`.

The project-import run accepted 33,344,717 bytes across three files in 70 ms and rendered in 493 ms. The cancel interaction returned the UI to the Run button in 51 ms while the compressed WASM request was held. This measures UI response, not worker computation time.

The script does not report a separate WASM instantiation duration or peak memory. Browser `performance.memory` is Chromium-specific and omits worker, WebAssembly, and process memory. The results do not measure a production CDN, real user devices, a full Web Vitals session, or enforce performance budgets.
