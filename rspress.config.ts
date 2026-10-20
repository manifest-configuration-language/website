import { defineConfig } from "@rspress/core";
import { pluginNodePolyfill } from "@rsbuild/plugin-node-polyfill";
import mclGrammar from "./src/playground/mcl.tmLanguage.json";

export default defineConfig({
  builderConfig: { plugins: [pluginNodePolyfill()] },
  root: ".build/rspress/docs",
  outDir: ".build/rspress/dist",
  title: "MCL",
  description: "MCL configuration language documentation",
  lang: "ja",
  markdown: {
    shiki: { langs: [{ ...mclGrammar, name: "mcl" }] },
  },
  themeConfig: {
    nav: [
      { text: "Playground", link: "/playground" },
      { text: "対応機能", link: "/playground/capabilities" },
      { text: "チュートリアル", link: "/tutorial/" },
      { text: "言語", link: "/reference/language" },
      { text: "標準ライブラリ", link: "/reference/stdlib" },
      { text: "仕様", link: "/reference/spec" },
    ],
  },
});
