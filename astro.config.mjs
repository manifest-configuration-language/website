import { readFileSync } from "node:fs";
import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import starlight from "@astrojs/starlight";

const grammar = JSON.parse(readFileSync("src/playground/mcl.tmLanguage.json", "utf8"));

export default defineConfig({
  site: "https://mcl.walnuts.dev",
  outDir: ".build/dist",
  integrations: [
    react(),
    starlight({
      title: "MCL",
      description: "MCL configuration language documentation",
      customCss: ["./src/styles/custom.css"],
      editLink: {
        baseUrl:
          "https://github.com/manifest-configuration-language/website/edit/main/src/content/docs/",
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
