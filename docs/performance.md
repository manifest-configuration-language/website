# Website performance baseline

Run `pnpm run build && pnpm exec playwright install chromium && node scripts/measure-performance.mjs` after a production build. The script starts an Astro preview server behind a local HTTP proxy, opens `/reference/` and `/playground/` in fresh Chromium contexts, measures the first Pagefind search for `型`, runs the Playground twice, measures cancellation UI response, and renders a project with two 15.9 MiB binary files. The proxy serves the fingerprinted WASM from the production build with `Content-Type: application/wasm` and `Content-Encoding: gzip` on the same origin, so Chromium uses `WebAssembly.instantiateStreaming` with HTTP decompression. The worker bundle is instrumented in the test context to time that call and inspect the exported Go WASM memory. The `web-vitals` library records INP for the scripted interactions on each page.

Baseline captured on 2026-10-22 from a local Apple Silicon macOS machine with Node.js 26.8.2 and Chromium 156.0.8078.4. Asset totals use response body bytes and exclude HTTP headers. The Playground downloads the fingerprinted 19,600,663-byte gzip WASM asset only when the user runs MCL. The values in this table are single-run observations affected by machine load and browser state; the CI thresholds below use separate, broader limits.

| Page           | Initial HTML | Initial JavaScript | Initial CSS | Initial other | Navigation load | FCP proxy | LCP proxy | CLS proxy | INP (lab) |
| -------------- | -----------: | -----------------: | ----------: | ------------: | --------------: | --------: | --------: | --------: | --------: |
| `/reference/`  | 27,766 bytes |      102,158 bytes | 68,074 bytes |       0 bytes |           75 ms |     56 ms |     72 ms |         0 |     48 ms |
| `/playground/` | 29,887 bytes |      626,350 bytes | 68,074 bytes |       0 bytes |           36 ms |     24 ms |     36 ms |    0.0523 |     32 ms |

The reference page does not load MCL WASM or create a CodeMirror editor. The first search for `型`, including opening Search and waiting for the first visible Pagefind result, took 869 ms and loaded 207,840 bytes of on-demand assets. This includes Pagefind's 68,199-byte WASM file and result fragments. The Playground creates CodeMirror without loading MCL WASM. Its first execution, including Worker startup, WASM transfer, runtime startup, and rendering, took 821 ms; the second took 42 ms. The `WebAssembly.instantiateStreaming` call took 149 ms from invocation until its promise resolved. That interval includes any remaining streamed response transfer as well as WebAssembly compilation and instantiation; it is not a compile-only duration. After execution, the Worker and WASM assets totaled 19,937,668 bytes, including the 337,005-byte Worker bundle with `wasm_exec.js`.

The project-import run accepted 33,344,717 bytes across three files in 71 ms and rendered in 523 ms. The cancel interaction returned the UI to the Run button in 36 ms while the compressed WASM request was held. This measures UI response, not worker computation time.

The `web-vitals` `onINP` implementation reported 48 ms for the reference page and 32 ms for the Playground during this scripted interaction session. These are lab INP measurements for the recorded interactions; they do not represent the field 75th percentile across real visits.

The Go WebAssembly module's exported `mem.buffer.byteLength` was 49,545,216 bytes immediately after instantiation, 86,507,520 bytes after the first render, and 142,344,192 bytes after rendering the 31.8 MiB binary project. These values are the current capacity of the WASM linear memory, not the number of bytes actively used by Go, resident physical memory, or total browser memory. They exclude JavaScript heap, DOM, browser process overhead, and other worker allocations. WebAssembly memory grows but does not shrink, so the last value is the largest linear-memory capacity reached in that run; it is not an overall browser peak-memory measurement.

The pull request, push, scheduled, and manual GitHub Actions workflows compare the four response-body byte totals against limits in [`scripts/performance-budget.json`](../scripts/performance-budget.json). Each limit is 15% above the local baseline in the table and the descriptions above: 227,512 bytes for initial `/reference/` assets, 832,303 bytes for initial `/playground/` assets, 240,907 bytes for the first search's on-demand assets, and 22,926,167 bytes for assets loaded by the first Playground execution.

The same workflows also enforce broad runtime ceilings. They use one Chromium run with generous headroom against the hosted CI baseline, so they detect large regressions without treating small timing variation as a failure.

| Runtime measurement | Maximum |
| --- | ---: |
| Reference navigation | 2.5 s |
| First Pagefind search | 5 s |
| Playground navigation | 2.5 s |
| WASM startup and first render | 10 s |
| Streaming WASM instantiation | 5 s |
| Repeat render | 2 s |
| Cancellation UI response | 2 s |
| 31.8 MiB project import | 2 s |
| 31.8 MiB project evaluation | 10 s |
| WASM linear-memory capacity after the large-project render | 256 MiB |
| Reference page LCP proxy | 2.5 s |
| Reference page CLS proxy | 0.1 |
| Reference page lab INP | 200 ms |

The performance workflow records measurements, limits, and pass/fail results in its summary and retains the JSON report as a 30-day artifact. Website CI runs the same check after browser E2E tests. Update the limits and this documentation when an intentional change establishes a new baseline. FCP and the Playground page's LCP and CLS measurements remain diagnostic. The reference page LCP, CLS, and lab INP limits catch large lab regressions; lab INP comes from this script's small, synthetic interaction set and does not represent the field 75th percentile across real visits.

The results do not measure a production CDN, real user devices, or a field Web Vitals session.
