import { readFile, readdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { parse } from "parse5";

const expectedDirectives = new Map([
  ["default-src", ["'self'"]],
  ["img-src", ["'self'", "data:"]],
  ["worker-src", ["'self'"]],
  ["connect-src", ["'self'"]],
  ["font-src", ["'self'", "data:"]],
  ["form-action", ["'self'"]],
  ["object-src", ["'none'"]],
  ["base-uri", ["'self'"]],
  ["style-src", ["'self'"]],
]);
const inlineHash = /^'sha256-[A-Za-z0-9+/]+={0,2}'$/;
const javascriptTypes = new Set([
  "",
  "module",
  "application/ecmascript",
  "application/javascript",
  "application/x-ecmascript",
  "application/x-javascript",
  "text/ecmascript",
  "text/javascript",
  "text/javascript1.0",
  "text/javascript1.1",
  "text/javascript1.2",
  "text/javascript1.3",
  "text/javascript1.4",
  "text/javascript1.5",
  "text/jscript",
  "text/livescript",
  "text/x-ecmascript",
  "text/x-javascript",
]);

async function htmlFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await htmlFiles(entryPath)));
    else if (entry.name.endsWith(".html")) files.push(entryPath);
  }
  return files;
}

function elements(node, predicate, matches = []) {
  if (predicate(node)) matches.push(node);
  for (const child of node.childNodes ?? []) elements(child, predicate, matches);
  return matches;
}

function contentSecurityPolicy(document, filePath) {
  const policies = elements(
    document,
    (node) =>
      node.tagName === "meta" &&
      node.attrs?.some(
        ({ name, value }) =>
          name === "http-equiv" && value.toLowerCase() === "content-security-policy",
      ),
  );
  if (policies.length === 0) {
    const hasExecutableContent =
      elements(document, (node) => node.tagName === "script" || node.tagName === "style").length >
      0;
    if (hasExecutableContent) {
      throw new Error(
        `${filePath} contains scripts or styles without an Astro-generated Content Security Policy.`,
      );
    }
    return undefined;
  }
  if (policies.length !== 1) {
    throw new Error(
      `${filePath} must contain exactly one Astro-generated Content Security Policy.`,
    );
  }
  const content = policies[0].attrs.find(({ name }) => name === "content")?.value;
  if (!content)
    throw new Error(`${filePath} has an empty Astro-generated Content Security Policy.`);

  const directives = new Map(
    content
      .split(";")
      .map((directive) => directive.trim())
      .filter(Boolean)
      .map((directive) => {
        const [name, ...sources] = directive.split(/\s+/);
        return [name, sources];
      }),
  );
  if (directives.size !== content.split(";").filter((directive) => directive.trim()).length) {
    throw new Error(`${filePath} contains duplicate Content Security Policy directives.`);
  }

  for (const [name, requiredSources] of expectedDirectives) {
    const sources = directives.get(name);
    if (!sources || requiredSources.some((source) => !sources.includes(source))) {
      throw new Error(`${filePath} is missing required ${name} sources.`);
    }
  }

  const allowedDirectives = new Map([
    ...expectedDirectives,
    ["script-src", ["'self'", "'wasm-unsafe-eval'"]],
    ["script-src-elem", ["'self'"]],
    ["style-src-elem", ["'self'", "'unsafe-inline'"]],
    ["style-src-attr", ["'unsafe-inline'"]],
  ]);
  for (const [name, sources] of directives) {
    const allowedSources = allowedDirectives.get(name);
    if (
      !allowedSources ||
      sources.some((source) => !allowedSources.includes(source) && !inlineHash.test(source))
    ) {
      throw new Error(
        `${filePath} contains an unapproved Content Security Policy source in ${name}.`,
      );
    }
  }

  if (
    !directives.get("script-src")?.includes("'self'") ||
    !directives.get("script-src")?.includes("'wasm-unsafe-eval'")
  ) {
    throw new Error(`${filePath} must allow same-origin scripts and WebAssembly evaluation.`);
  }
  if (!directives.get("style-src-attr")?.includes("'unsafe-inline'")) {
    throw new Error(
      `${filePath} must allow the inline style attributes used by the documentation.`,
    );
  }

  return policies[0];
}

function inlineScriptHashes(document) {
  return elements(document, (node) => node.tagName === "script")
    .flatMap((script) => {
      if (script.attrs?.some(({ name }) => name === "src")) return [];
      const type =
        script.attrs
          ?.find(({ name }) => name === "type")
          ?.value.trim()
          .toLowerCase() ?? "";
      if (!javascriptTypes.has(type)) return [];
      const body = (script.childNodes ?? []).map((node) => node.value ?? "").join("");
      return body.trim() ? [body] : [];
    })
    .map((body) => {
      return `'sha256-${createHash("sha256").update(body).digest("base64")}'`;
    });
}

function addFallbackHashes(policy, hashesByDirective, filePath) {
  const contentAttribute = policy.sourceCodeLocation?.attrs?.content;
  const content = policy.attrs.find(({ name }) => name === "content")?.value;
  if (!contentAttribute || !content) {
    throw new Error(`${filePath} has no source location for its CSP content attribute.`);
  }
  const directives = content
    .split(";")
    .map((directive) => directive.trim())
    .filter(Boolean);
  for (const [name, hashes] of Object.entries(hashesByDirective)) {
    const index = directives.findIndex((directive) => directive.startsWith(`${name} `));
    if (index < 0) throw new Error(`${filePath} has no ${name} directive.`);
    const sources = directives[index].split(/\s+/);
    for (const hash of hashes) {
      if (!sources.includes(hash)) sources.push(hash);
    }
    directives[index] = sources.join(" ");
  }
  return {
    start: contentAttribute.startOffset,
    end: contentAttribute.endOffset,
    replacement: `content="${directives.join("; ")}"`,
  };
}

const [siteDirectory] = process.argv.slice(2);
if (!siteDirectory || process.argv.length !== 3) {
  throw new Error("Usage: node write-csp.mjs <site-directory>");
}

const files = await htmlFiles(siteDirectory);
if (files.length === 0) throw new Error(`${siteDirectory} contains no HTML files.`);
for (const filePath of files) {
  const html = await readFile(filePath, "utf8");
  const document = parse(html, { sourceCodeLocationInfo: true });
  const policy = contentSecurityPolicy(document, filePath);
  if (!policy) continue;
  const hashAttribute = addFallbackHashes(
    policy,
    {
      "script-src": inlineScriptHashes(document),
    },
    filePath,
  );
  const withHashes =
    html.slice(0, hashAttribute.start) + hashAttribute.replacement + html.slice(hashAttribute.end);
  const updatedDocument = parse(withHashes, { sourceCodeLocationInfo: true });
  const updatedPolicy = contentSecurityPolicy(updatedDocument, filePath);
  const head = elements(updatedDocument, (node) => node.tagName === "head")[0];
  const charset = head?.childNodes.find(
    (node) =>
      node.tagName === "meta" &&
      node.attrs?.some(({ name, value }) => name === "charset" && value.toLowerCase() === "utf-8"),
  );
  const policyStart = updatedPolicy?.sourceCodeLocation?.startTag?.startOffset;
  const policyEnd = updatedPolicy?.sourceCodeLocation?.startTag?.endOffset;
  const insertionPoint =
    charset?.sourceCodeLocation?.endTag?.endOffset ??
    charset?.sourceCodeLocation?.startTag?.endOffset ??
    head?.sourceCodeLocation?.startTag?.endOffset;
  if (policyStart === undefined || policyEnd === undefined || insertionPoint === undefined) {
    throw new Error(`${filePath} has no movable CSP meta element or head element.`);
  }

  if (policyStart > insertionPoint) {
    const policyTag = withHashes.slice(policyStart, policyEnd);
    const withoutPolicy = withHashes.slice(0, policyStart) + withHashes.slice(policyEnd);
    const adjustedInsertionPoint =
      insertionPoint > policyStart ? insertionPoint - (policyEnd - policyStart) : insertionPoint;
    await writeFile(
      filePath,
      withoutPolicy.slice(0, adjustedInsertionPoint) +
        policyTag +
        withoutPolicy.slice(adjustedInsertionPoint),
    );
  } else if (withHashes !== html) {
    await writeFile(filePath, withHashes);
  }
}
