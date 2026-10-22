import { useEffect, useRef } from "react";
import {
  bracketMatching,
  defaultHighlightStyle,
  indentUnit,
  syntaxHighlighting,
} from "@codemirror/language";
import { mclLanguageSupport } from "@manifest-configuration-language/language";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { closeBracketsKeymap } from "@codemirror/autocomplete";

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
            bracketMatching(),
            mclLanguageSupport(),
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
