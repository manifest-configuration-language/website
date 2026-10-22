import { brotliCompressSync, constants as zlibConstants, gzipSync } from "node:zlib";
import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import starlight from "@astrojs/starlight";
import grammar from "@manifest-configuration-language/language/textmate" with { type: "json" };

function compressFingerprintedAssets() {
  return {
    name: "mcl-precompressed-assets",
    apply: "build",
    generateBundle(_options, bundle) {
      for (const asset of Object.values(bundle)) {
        if (
          asset.type !== "asset" ||
          !/(?:^|\/)[^/]+[.-][A-Za-z0-9_-]{8,}\.(?:css|js|wasm)$/.test(asset.fileName)
        )
          continue;
        this.emitFile({
          type: "asset",
          fileName: `${asset.fileName}.br`,
          source: brotliCompressSync(asset.source, {
            params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 9 },
          }),
        });
        this.emitFile({
          type: "asset",
          fileName: `${asset.fileName}.gz`,
          source: gzipSync(asset.source, { level: 9, mtime: 0 }),
        });
      }
    },
  };
}

export default defineConfig({
  site: "https://mcl.walnuts.dev",
  outDir: ".build/dist",
  security: {
    csp: {
      algorithm: "SHA-256",
      directives: [
        "default-src 'self'",
        "img-src 'self' data:",
        "worker-src 'self'",
        "connect-src 'self'",
        "font-src 'self' data:",
        "form-action 'self'",
        "object-src 'none'",
        "base-uri 'self'",
      ],
      scriptDirective: {
        resources: ["'self'", "'wasm-unsafe-eval'"],
      },
      styleDirective: {
        resources: [
          { resource: "'self'", kind: "element" },
          { resource: "'unsafe-inline'", kind: "element" },
          { resource: "'unsafe-inline'", kind: "attribute" },
        ],
      },
    },
  },
  redirects: {
    "/reference/language": "/reference/",
    "/reference/architecture/parser-ast": "/internals/parser-ast/",
    "/reference/architecture/deferred-evaluation": "/internals/deferred-evaluation/",
  },
  vite: {
    plugins: [compressFingerprintedAssets()],
  },
  integrations: [
    react(),
    starlight({
      title: "MCL",
      description: "MCL configuration language documentation",
      customCss: ["./src/styles/custom.css"],
      editLink: {
        baseUrl: "https://github.com/manifest-configuration-language/website/edit/main/",
      },
      expressiveCode: { shiki: { langs: [{ ...grammar, name: "mcl" }] } },
      defaultLocale: "root",
      locales: { root: { label: "日本語", lang: "ja" } },
      sidebar: [
        { label: "導入", items: [{ autogenerate: { directory: "getting-started" } }] },
        { label: "チュートリアル", items: [{ autogenerate: { directory: "tutorial" } }] },
        { label: "ガイド", items: [{ autogenerate: { directory: "guide" } }] },
        { label: "リファレンス", items: [{ autogenerate: { directory: "reference" } }] },
        { label: "内部仕様", items: [{ autogenerate: { directory: "internals" } }] },
        { label: "Playground", link: "/playground/" },
      ],
    }),
  ],
});
