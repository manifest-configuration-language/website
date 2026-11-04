import type { EditorView } from "@codemirror/view";

type EditorRequestSnapshot = {
  revision: number;
  expectedRevision: number;
  editor: EditorView | undefined;
  expectedEditor: EditorView;
  activePath: string;
  expectedPath: string;
  source?: string;
  currentSource?: string;
};

export function isCurrentEditorRequest({
  revision,
  expectedRevision,
  editor,
  expectedEditor,
  activePath,
  expectedPath,
  source,
  currentSource,
}: EditorRequestSnapshot): boolean {
  return (
    revision === expectedRevision &&
    editor === expectedEditor &&
    activePath === expectedPath &&
    (source === undefined || source === currentSource)
  );
}
