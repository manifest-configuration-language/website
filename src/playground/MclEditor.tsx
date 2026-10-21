import { useEffect, useRef } from "react";
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
      if (close < 0) stream.skipToEnd();
      else {
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

type Props = {
  onReady: (view: EditorView | undefined) => void;
  onDocumentChange: () => void;
  onError: (error: Error) => void;
};

export function MclEditor({ onReady, onDocumentChange, onError }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onReady, onDocumentChange, onError });
  callbacks.current = { onReady, onDocumentChange, onError };

  useEffect(() => {
    if (!host.current) return;
    let view: EditorView | undefined;
    try {
      view = new EditorView({
        parent: host.current,
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
              if (update.docChanged) callbacks.current.onDocumentChange();
            }),
            keymap.of([...closeBracketsKeymap, indentWithTab, ...defaultKeymap, ...historyKeymap]),
          ],
        }),
      });
      callbacks.current.onReady(view);
    } catch (cause) {
      callbacks.current.onError(cause instanceof Error ? cause : new Error(String(cause)));
    }
    return () => {
      callbacks.current.onReady(undefined);
      view?.destroy();
    };
  }, []);

  return <div className="playground-editor" ref={host} />;
}
