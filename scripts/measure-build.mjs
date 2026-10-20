import { gzipSync } from "node:zlib";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const builds = [
  {
    name: "Rspress",
    root: ".build/rspress/dist",
    routes: {
      language: "reference/language.html",
      playground: "playground.html",
    },
  },
  {
    name: "Astro + Starlight",
    root: ".build/astro/dist",
    routes: {
      language: "reference/language/index.html",
      playground: "playground/index.html",
    },
  },
];

function attributes(tag) {
  return Object.fromEntries(
    [...tag.matchAll(/([\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)].map((match) => [
      match[1],
      match[2] ?? match[3] ?? match[4] ?? "",
    ]),
  );
}

async function collect(build, route) {
  const html = await readFile(path.join(build.root, route), "utf8");
  const scripts = new Set();
  const styles = new Set();
  for (const match of html.matchAll(/<(script|link|astro-island)\b[^>]*>/gi)) {
    const attrs = attributes(match[0]);
    if (match[1].toLowerCase() === "script" && attrs.src) scripts.add(attrs.src);
    if (
      match[1].toLowerCase() === "link" &&
      attrs.rel?.split(/\s+/).includes("preload") &&
      attrs.as === "script" &&
      attrs.href
    )
      scripts.add(attrs.href);
    if (match[1].toLowerCase() === "astro-island") {
      if (attrs["component-url"]) scripts.add(attrs["component-url"]);
      if (attrs["renderer-url"]) scripts.add(attrs["renderer-url"]);
    }
    if (
      match[1].toLowerCase() === "link" &&
      attrs.rel?.split(/\s+/).some((rel) => rel === "stylesheet") &&
      attrs.media !== "print" &&
      attrs.href
    )
      styles.add(attrs.href);
  }

  const visitedScripts = new Set();
  while ([...scripts].some((script) => !visitedScripts.has(script))) {
    const asset = [...scripts].find((script) => !visitedScripts.has(script));
    visitedScripts.add(asset);
    if (!asset.startsWith("/")) continue;
    const file = path.join(build.root, asset.replace(/^\//, "").split(/[?#]/)[0]);
    const content = await readFile(file, "utf8");
    for (const match of content.matchAll(
      /(?:\bfrom\s*|\bimport\s*)["']([^"']+\.js(?:\?[^"']*)?)["']/g,
    )) {
      if (!match[1].startsWith(".")) continue;
      const imported = path.posix.normalize(path.posix.join(path.posix.dirname(asset), match[1]));
      scripts.add(imported);
    }
  }
  const totals = { js: { raw: 0, gzip: 0 }, css: { raw: 0, gzip: 0 } };
  for (const [kind, assets] of [
    ["js", scripts],
    ["css", styles],
  ]) {
    for (const asset of assets) {
      if (!asset.startsWith("/")) continue;
      const content = await readFile(path.join(build.root, asset.slice(1).split(/[?#]/)[0]));
      totals[kind].raw += content.length;
      totals[kind].gzip += gzipSync(content, { level: 9 }).length;
    }
  }
  return totals;
}

for (const build of builds) {
  await stat(build.root);
  for (const [route, page] of Object.entries(build.routes)) {
    const totals = await collect(build, page);
    const kb = (size) => (size / 1000).toFixed(1);
    console.log(
      `${build.name}\t${route}\tJS ${kb(totals.js.raw)}/${kb(totals.js.gzip)} kB\tCSS ${kb(totals.css.raw)}/${kb(totals.css.gzip)} kB`,
    );
  }
}
