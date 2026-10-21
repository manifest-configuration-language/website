import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import starlight from "@astrojs/starlight";

const grammar = JSON.parse(readFileSync("src/playground/mcl.tmLanguage.json", "utf8"));
const workerNodeModules = {
  "node:buffer": "buffer/index.js",
  "node:events": "events/events.js",
  "node:path": "path-browserify",
  "node:stream": "stream-browserify",
  "node:url": "url/url.js",
};

function workerNodeBuiltinPlugin() {
  return {
    name: "mcl-worker-node-builtins",
    enforce: "pre",
    resolveId(source) {
      if (Object.hasOwn(workerNodeModules, source))
        return fileURLToPath(import.meta.resolve(workerNodeModules[source]));
    },
  };
}

export default defineConfig({
  site: "https://mcl.walnuts.dev",
  outDir: ".build/dist",
  redirects: {
    "/reference/language": "/reference/",
    "/reference/architecture/parser-ast": "/internals/parser-ast/",
    "/reference/architecture/deferred-evaluation": "/internals/deferred-evaluation/",
  },
  vite: {
    optimizeDeps: { rolldownOptions: { plugins: [workerNodeBuiltinPlugin()] } },
    worker: {
      plugins: () => [workerNodeBuiltinPlugin()],
    },
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
        { label: "はじめる", items: [{ autogenerate: { directory: "getting-started" } }] },
        { label: "チュートリアル", items: [{ autogenerate: { directory: "tutorial" } }] },
        { label: "リファレンス", items: [{ autogenerate: { directory: "reference" } }] },
        { label: "内部仕様", items: [{ autogenerate: { directory: "internals" } }] },
        { label: "Playground", link: "/playground/" },
      ],
    }),
  ],
});
