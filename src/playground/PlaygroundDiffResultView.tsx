import { useEffect, useRef } from "react";
import { MergeView } from "@codemirror/merge";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { ResourceBrowser, type YamlResource } from "./PlaygroundYamlResultView";

type Props = {
  previousYaml: string;
  currentYaml: string;
  fontSize: number;
  resources: YamlResource[];
  selectedResource?: YamlResource;
  showResources: boolean;
  onToggleResources: () => void;
  onSelectResource: (resource: YamlResource) => void;
  onResetResource: () => void;
};

export function PlaygroundDiffResultView({
  previousYaml,
  currentYaml,
  fontSize,
  resources,
  selectedResource,
  showResources,
  onToggleResources,
  onSelectResource,
  onResetResource,
}: Props) {
  const diffHost = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const parent = diffHost.current;
    if (!parent) return;
    const readOnly = [
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
      EditorView.lineWrapping,
      EditorView.theme({ ".cm-content, .cm-gutters": { fontSize: `${fontSize}px` } }),
    ];
    const previousText = selectedResource ? (selectedResource.previous?.yaml ?? "") : previousYaml;
    const currentText = selectedResource ? (selectedResource.current?.yaml ?? "") : currentYaml;
    const merge = new MergeView({
      a: { doc: previousText, extensions: readOnly },
      b: { doc: currentText, extensions: readOnly },
      parent,
      gutter: true,
      highlightChanges: true,
    });
    return () => merge.destroy();
  }, [currentYaml, fontSize, previousYaml, selectedResource]);

  return (
    <section className="playground-diff" aria-label="YAML差分">
      <div className="playground-diff-labels">
        <span>{selectedResource ? (selectedResource.previous ? "前回" : "追加") : "前回"}</span>
        <div className="playground-diff-resource-controls">
          <button
            type="button"
            className="playground-diff-resource-toggle"
            aria-pressed={showResources}
            onClick={onToggleResources}
            disabled={resources.length === 0}
          >
            {selectedResource?.label ?? "全体"}
          </button>
          {selectedResource && (
            <button
              type="button"
              className="playground-diff-resource-reset"
              onClick={onResetResource}
            >
              全体
            </button>
          )}
        </div>
        <span>{selectedResource ? (selectedResource.current ? "最新" : "削除") : "最新"}</span>
      </div>
      <ResourceBrowser
        resources={resources}
        onSelect={onSelectResource}
        hidden={!showResources}
        showChanges
      />
      <div className="playground-diff-editor" ref={diffHost} hidden={showResources} />
    </section>
  );
}
