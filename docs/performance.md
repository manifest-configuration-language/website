# Website performance baseline

The baseline records static asset bytes and local browser timings for `/reference/language/` and `/playground/`. Run it after a production build with `pnpm run build && pnpm exec playwright install chromium && node scripts/measure-performance.mjs`. The script starts a fresh Astro preview server, opens each page in a fresh Chromium context, totals same-origin non-document response bodies, then runs the Playground starter program and waits for its rendered output. The compressed `mcl.wasm.gz` file is included in the Playground total after the run completes.

Baseline captured on 2026-10-21 from a local Apple Silicon macOS machine with Node.js 26.8.2 and Chromium 156.0.8078.4. The preview server was freshly started for this run. Asset totals are response body bytes and do not include HTTP headers; the WASM asset is the compressed file served by the site. Timings are single-run observations and depend on the machine, browser cache state, and load, so they are diagnostic values rather than acceptance thresholds.

| Page | Same-origin assets | Page load | Playground execution |
| --- | ---: | ---: | ---: |
| `/reference/language/` | 170,232 bytes | 30 ms | — |
| `/playground/` | 20,587,470 bytes | 31 ms | 845 ms |

The Playground asset total includes the 19,549,336-byte compressed WASM runtime, which loads only after execution begins. `previewReadyMs` was 923 ms for the local preview server. The script does not measure a production CDN, compression negotiated at the edge, real user devices, or Core Web Vitals. It also does not establish a performance budget.
