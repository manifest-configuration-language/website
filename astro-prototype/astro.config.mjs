import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import starlight from "@astrojs/starlight";
import { fileURLToPath } from "node:url";
import mclGrammar from "../src/playground/mcl.tmLanguage.json";

export default defineConfig({
  site: "https://mcl.walnuts.dev",
  outDir: fileURLToPath(new URL("../.build/astro/dist", import.meta.url)),
  integrations: [
    react(),
    starlight({
      title: "MCL",
      description: "MCL configuration language documentation",
      expressiveCode: { shiki: { langs: [{ ...mclGrammar, name: "mcl" }] } },
      defaultLocale: "root",
      locales: { root: { label: "日本語", lang: "ja" } },
      sidebar: [
        { label: "チュートリアル", items: [{ autogenerate: { directory: "tutorial" } }] },
        { label: "リファレンス", items: [
          { label: "言語", link: "/reference/language/" },
          { label: "標準ライブラリ", link: "/reference/stdlib/" },
          { label: "仕様", link: "/reference/spec/" },
        ] },
        { label: "Playground", link: "/playground/" },
      ],
    }),
  ],
});
