import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import starlight from "@astrojs/starlight";
import { nodePolyfills } from "vite-plugin-node-polyfills";

const grammar = JSON.parse(readFileSync("src/playground/mcl.tmLanguage.json", "utf8"));

const polyfills = { globals: { Buffer: true, global: false, process: true } };

export default defineConfig({
  site: "https://mcl.walnuts.dev",
  outDir: ".build/dist",
  vite: {
    plugins: [
      nodePolyfills({
        ...polyfills,
        include: ["buffer", "events", "process", "stream", "url", "util"],
      }),
    ],
    worker: {
      plugins: () => [
        {
          name: "mcl-worker-path-polyfill",
          enforce: "pre",
          resolveId(source) {
            if (source === "node:path")
              return fileURLToPath(import.meta.resolve("path-browserify"));
          },
        },
        nodePolyfills({
          ...polyfills,
          include: ["buffer", "events", "path", "process", "stream", "url", "util"],
        }),
      ],
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
        { label: "チュートリアル", items: [{ autogenerate: { directory: "tutorial" } }] },
        {
          label: "リファレンス",
          items: [
            { label: "言語", link: "/reference/language/" },
            { label: "標準ライブラリ", link: "/reference/stdlib/" },
            { label: "仕様", link: "/reference/spec/" },
          ],
        },
        { label: "Playground", link: "/playground/" },
      ],
    }),
  ],
});
