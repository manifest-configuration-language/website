import React, { useEffect, useRef, useState, type ChangeEvent } from "react";
import {
  bracketMatching,
  defaultHighlightStyle,
  indentUnit,
  StreamLanguage,
  syntaxHighlighting,
} from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import mclGrammar from "./mcl.tmLanguage.json";
import { createPlaygroundClient } from "./apiClient";
import type { PlaygroundDiagnostic, PlaygroundReply, ProjectFile } from "./types";

const maxProjectBytes = 32 * 1024 * 1024;
const maxMainBytes = 64 * 1024;
const maxFileBytes = 16 * 1024 * 1024;
const textExtensions = new Set([
  "mcl",
  "yaml",
  "yml",
  "json",
  "jsonnet",
  "tpl",
  "txt",
  "md",
  "lock",
  "toml",
  "properties",
  "xml",
  "sh",
  "conf",
]);

type GrammarRule = {
  name?: string;
  match?: string;
  begin?: string;
  end?: string;
  patterns?: GrammarRule[];
  include?: string;
};
type Grammar = { patterns: GrammarRule[]; repository: Record<string, GrammarRule> };
type LexerState = { quote?: string };
const tokenNames = {
  "comment.line.number-sign.mcl": tags.comment,
  "string.quoted.double.mcl": tags.string,
  "string.quoted.multi.double.mcl": tags.string,
  "constant.character.escape.mcl": tags.escape,
  "keyword.control.mcl": tags.keyword,
  "keyword.operator.mcl": tags.operator,
  "constant.language.mcl": tags.atom,
  "storage.type.mcl": tags.typeName,
  "entity.name.function.mcl": tags.function(tags.variableName),
  "constant.numeric.mcl": tags.number,
  "punctuation.separator.key-value.mcl": tags.punctuation,
  "punctuation.separator.comma.mcl": tags.punctuation,
  "punctuation.accessor.mcl": tags.punctuation,
};
const grammar = mclGrammar as unknown as Grammar;

function grammarRules(patterns: GrammarRule[]): GrammarRule[] {
  return patterns.flatMap((rule) =>
    rule.include?.startsWith("#")
      ? grammarRules(
          grammar.repository[rule.include.slice(1)].patterns ?? [
            grammar.repository[rule.include.slice(1)],
          ],
        )
      : [rule],
  );
}

const mclRules = grammarRules(grammar.patterns);
const mclLanguage = StreamLanguage.define({
  tokenTable: tokenNames,
  startState: (): LexerState => ({}),
  token(stream, state) {
    if (stream.eatSpace()) return null;
    if (state.quote) {
      const close = stream.string.indexOf(state.quote, stream.pos);
      if (close < 0) {
        stream.skipToEnd();
      } else {
        stream.pos = close + state.quote.length;
        state.quote = undefined;
      }
      return "string";
    }
    for (const rule of mclRules) {
      const pattern = rule.begin ?? rule.match;
      if (!pattern || !stream.match(new RegExp(`^(?:${pattern})`))) continue;
      if (rule.begin) state.quote = rule.end?.replaceAll('\\"', '"') ?? '"';
      return rule.name ?? null;
    }
    stream.next();
    return null;
  },
});

const initialSource = `let appName = "catalog"
let configMap =
  apiVersion: "v1"
  kind: "ConfigMap"
  metadata:
    name: appName
  data:
    mode: "development"

emit configMap
`;
const directoryInputProps = {
  webkitdirectory: "",
} as React.InputHTMLAttributes<HTMLInputElement> & { webkitdirectory: string };

export default function Playground() {
  const editorHost = useRef<HTMLDivElement>(null);
  const editor = useRef<EditorView | undefined>(undefined);
  const client = useRef<ReturnType<typeof createPlaygroundClient> | undefined>(undefined);
  const revision = useRef(0);
  const active = useRef(false);
  const [reply, setReply] = useState<PlaygroundReply>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [projectFiles, setProjectFiles] = useState<Record<string, ProjectFile>>({});
  const [projectSize, setProjectSize] = useState(0);

  useEffect(() => {
    if (!editorHost.current) return;
    const view = new EditorView({
      parent: editorHost.current,
      state: EditorState.create({
        doc: initialSource,
        extensions: [
          lineNumbers(),
          EditorView.contentAttributes.of({ "aria-label": "MCLソース" }),
          history(),
          closeBrackets(),
          bracketMatching(),
          mclLanguage,
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          indentUnit.of("  "),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              revision.current += 1;
              if (active.current) client.current?.cancel();
              active.current = false;
              setBusy(false);
              setReply(undefined);
              setError("");
            }
          }),
          keymap.of([...closeBracketsKeymap, indentWithTab, ...defaultKeymap, ...historyKeymap]),
        ],
      }),
    });
    editor.current = view;
    client.current = createPlaygroundClient();
    return () => {
      view.destroy();
      client.current?.dispose();
    };
  }, []);

  async function run() {
    if (!editor.current || !client.current) return;
    const currentRevision = ++revision.current;
    active.current = true;
    setBusy(true);
    setError("");
    setReply(undefined);
    try {
      const result = await client.current.run(
        editor.current.state.doc.toString(),
        currentRevision,
        projectFiles,
      );
      if (currentRevision === revision.current) setReply(result);
    } catch (cause) {
      if (currentRevision === revision.current)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (currentRevision === revision.current) {
        active.current = false;
        setBusy(false);
      }
    }
  }

  async function formatSource() {
    if (!editor.current || !client.current) return;
    const currentRevision = ++revision.current;
    active.current = true;
    setBusy(true);
    setError("");
    setReply(undefined);
    try {
      const result = await client.current.format(
        editor.current.state.doc.toString(),
        currentRevision,
      );
      if (currentRevision !== revision.current) return;
      if (!result.ok) {
        setReply(result);
      } else if (result.result?.source !== undefined) {
        const view = editor.current;
        if (view)
          view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: result.result.source },
          });
      }
    } catch (cause) {
      if (currentRevision === revision.current)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (currentRevision === revision.current) {
        active.current = false;
        setBusy(false);
      }
    }
  }

  function cancel() {
    revision.current += 1;
    active.current = false;
    client.current?.cancel();
    setBusy(false);
    setError("");
    setReply(undefined);
  }

  async function loadProject(event: ChangeEvent<HTMLInputElement>) {
    const selected = [...(event.currentTarget.files ?? [])];
    event.currentTarget.value = "";
    if (selected.length === 0) return;
    try {
      if (selected.length > 4096) throw new Error("A project can contain at most 4,096 files.");
      const paths = selected.map((file) => file.webkitRelativePath || file.name);
      const roots = new Set(paths.map((path) => path.split("/")[0]));
      const stripRoot = roots.size === 1 && selected.some((file) => file.webkitRelativePath !== "");
      const normalized = selected.map((file, index) => ({
        file,
        path: stripRoot ? paths[index].slice(paths[index].indexOf("/") + 1) : paths[index],
      }));
      const main = normalized.find(({ path }) => path === "main.mcl");
      if (!main) throw new Error("The selected directory must contain main.mcl at its root.");
      if (main.file.size > maxMainBytes) throw new Error("main.mcl exceeds the 64 KiB limit.");
      const nextFiles = Object.create(null) as Record<string, ProjectFile>;
      let total = main.file.size;
      for (const { file, path } of normalized) {
        if (file === main.file) continue;
        if (
          !path ||
          path.startsWith("/") ||
          path.split("/").some((part) => part === ".." || part === ".")
        )
          throw new Error(`Invalid project path: ${path}`);
        if (file.size > maxFileBytes) throw new Error(`${path} exceeds the 16 MiB per-file limit.`);
        total += file.size;
        if (total > maxProjectBytes) throw new Error("The project exceeds the 32 MiB total limit.");
        const extension = path.split(".").pop()?.toLowerCase() ?? "";
        if (textExtensions.has(extension)) {
          nextFiles[path] = { encoding: "utf8", content: await file.text() };
        } else {
          nextFiles[path] = { encoding: "binary", bytes: new Uint8Array(await file.arrayBuffer()) };
        }
      }
      const source = await main.file.text();
      if (editor.current)
        editor.current.dispatch({
          changes: { from: 0, to: editor.current.state.doc.length, insert: source },
        });
      setProjectFiles(nextFiles);
      setProjectSize(total);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  function goToDiagnostic(diagnostic: PlaygroundDiagnostic) {
    const view = editor.current;
    if (!view) return;
    const line = view.state.doc.line(Math.min(Math.max(diagnostic.line, 1), view.state.doc.lines));
    const position = Math.min(line.from + Math.max(diagnostic.column - 1, 0), line.to);
    view.dispatch({ selection: { anchor: position }, scrollIntoView: true });
    view.focus();
  }

  return (
    <section className="playground" aria-label="MCLプレイグラウンド">
      <div className="playground-toolbar">
        {busy ? (
          <button type="button" onClick={cancel}>
            中断
          </button>
        ) : (
          <>
            <button type="button" onClick={run}>
              実行
            </button>
            <button type="button" onClick={formatSource}>
              整形
            </button>
          </>
        )}
        <label>
          プロジェクト
          <input
            type="file"
            multiple
            {...directoryInputProps}
            aria-label="MCLプロジェクトフォルダー"
            onChange={loadProject}
          />
        </label>
        <span>
          {Object.keys(projectFiles).length} files · {(projectSize / 1024 / 1024).toFixed(1)} / 32
          MiB
        </span>
        <a href="/playground/capabilities">対応機能</a>
      </div>
      <div className="playground-editor" ref={editorHost} />
      {error && <p role="alert">{error}</p>}
      {reply && !reply.ok && reply.error && (
        <p role="alert">
          <button className="diagnostic" onClick={() => goToDiagnostic(reply.error!)}>
            {reply.error.code}: {reply.error.message} ({reply.error.line}:{reply.error.column})
          </button>
        </p>
      )}
      {reply?.diagnostics && reply.diagnostics.length > 0 && (
        <ul className="playground-diagnostics">
          {reply.diagnostics.map((diagnostic, index) => (
            <li key={`${diagnostic.code}-${diagnostic.line}-${index}`}>
              <button className="diagnostic" onClick={() => goToDiagnostic(diagnostic)}>
                {diagnostic.severity}: {diagnostic.message} ({diagnostic.line}:{diagnostic.column})
              </button>
            </li>
          ))}
        </ul>
      )}
      {reply?.ok && (
        <pre className="playground-output" aria-label="レンダリング結果">
          <code>{reply.result?.yaml}</code>
        </pre>
      )}
    </section>
  );
}
